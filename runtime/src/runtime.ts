import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { Desk, type DeskOptions } from './desk.ts';
import { OWNED, ROOT } from './config.ts';
import { ModelManager, MODEL_CATALOG } from './models.ts';
import { accountLabel } from './credentials.ts';

export class Runtime {
  readonly desks = new Map<string, Desk>();
  readonly options: DeskOptions;
  readonly models: ModelManager;
  constructor(options: DeskOptions = {}) {
    this.options = options; this.desks.set('default', new Desk({ ...options, screenshots: options.screenshots ?? join(ROOT, 'data/screenshots/default') }));
    this.models = new ModelManager(async () => {
      if ([...this.desks.values()].some(desk => desk.busy || desk.pending || desk.credentialRequest || desk.desktopTask)) return true;
      const token = process.env.HALO_SESSION_TOKEN ?? (await readFile(join(ROOT, '.cache/halo/session-token'), 'utf8')).trim();
      const response = await fetch('http://127.0.0.1:3210/api/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'workspace:list', args: { token }, format: 'json' }), signal: AbortSignal.timeout(3000) });
      const result = await response.json();
      if (result.status !== 'success') throw new Error('Cannot check active bots. Keep the current model until Convex reconnects.');
      return result.value.threads.some((thread: { activeRunId?: string }) => !!thread.activeRunId);
    }, ROOT, MODEL_CATALOG, async changing => {
      const token = process.env.HALO_SESSION_TOKEN ?? (await readFile(join(ROOT, '.cache/halo/session-token'), 'utf8')).trim();
      const response = await fetch('http://127.0.0.1:3210/api/mutation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'workspace:modelControl', args: { token, changing }, format: 'json' }), signal: AbortSignal.timeout(3000) });
      const result = await response.json(); if (result.status !== 'success') throw new Error('Wait for all bots to finish and reconnect to Convex before switching models.');
    });
  }
  resolve(threadId: string) {
    if (threadId !== 'default' && !/^[a-z0-9]{20,64}$/.test(threadId)) throw new Error('Invalid thread ID.');
    let desk = this.desks.get(threadId);
    if (!desk) { desk = new Desk({ ...this.options, screenshots: join(this.options.screenshots ?? join(ROOT, 'data/screenshots'), threadId), owned: join(dirname(this.options.owned ?? OWNED), 'threads', threadId + '.json') }); this.desks.set(threadId, desk); }
    return desk;
  }
  async legacyHistory() {
    const path = process.env.HOLO_CHAT_DB ?? join(ROOT, 'data/chat.sqlite3');
    if (!existsSync(path)) return [];
    // Recovery source only. New history belongs exclusively to Convex.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path, { readOnly: true });
    try { return db.prepare('SELECT role, text FROM messages ORDER BY id').all(); }
    finally { db.close(); }
  }
  async reconcile(token: string) {
    const call = async (kind: string, path: string, args: object) => {
      const response = await fetch('http://127.0.0.1:3210/api/' + kind, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, args: { token, ...args }, format: 'json' }), signal: AbortSignal.timeout(5000) });
      const value = await response.json(); if (value.status !== 'success') throw new Error('Convex state reconciliation failed.'); return value.value;
    };
    const workspace = await call('query', 'workspace:list', {});
    for (const thread of workspace.threads) {
      const desk = this.resolve(thread._id);
      await call('mutation', 'workspace:syncExecutorState', { threadId: thread._id, sandbox: !!desk.sb, phase: desk.phase });
    }
  }
  async dispatch(path: string, body: Record<string, unknown>, threadId = 'default'): Promise<unknown> {
    const desk = this.resolve(threadId);
    if (path === '/api/models') return this.models.snapshot();
    if (path === '/api/model/start') return this.models.start(body.id);
    if (path === '/api/model/stop') return this.models.stop();
    if (path === '/api/model/download') return this.models.download(body.id);
    if (path === '/api/state') return desk.snapshot();
    if (path === '/api/model') { try { const value = await desk.request('/health'); return { ok: value.status === 'ok' }; } catch { return { ok: false, error: 'Start a local model and wait until it is ready.' }; } }
    if (path === '/api/legacy-history') return { messages: await this.legacyHistory() };
    if (path === '/api/thread-context') {
      if (desk.busy || desk.pending || desk.credentialRequest) throw new Error('This thread is already working or awaiting approval.');
      const context = z.object({ instructions: z.string().max(6500).default(''), messages: z.array(z.object({ role: z.enum(['user', 'assistant', 'system']), text: z.string().max(20000) })).max(100).default([]) }).parse(body);
      desk.instructions = context.instructions; desk.messages = context.messages.slice(-60);
      desk.history = context.messages.slice(-12).filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.text }));
      return desk.snapshot();
    }
    if (path === '/api/stop') {
      if (desk.phase !== 'stopping') {
        const work = desk.stop().finally(() => desk.tasks.delete(work)); desk.tasks.add(work);
      }
      return { accepted: true };
    }
    if (['stopping', 'cleanup required'].includes(desk.phase)) throw new Error('Cleanup is in progress or needs a retry. Use Stop.');
    if (path === '/api/clear-chat') { desk.clearChat(); return { accepted: true }; }
    if (path === '/api/downloads') return desk.listDownloads();
    if (path === '/api/accounts') return { accounts: await desk.vault.list?.(website(body.origin)) ?? [] };
    if (path === '/api/forget-login') { await desk.vault.delete(website(body.origin), accountLabel.parse(body.account ?? '')); return { accepted: true }; }
    if (path === '/api/approval-mode') { desk.setApprovalMode(body.enabled); if (desk.approveAll && desk.pending && !desk.busy) { const pending = desk.pending; desk.launch(() => desk.approve(pending.id)); } return { accepted: true }; }
    const operations: Record<string, () => Promise<unknown>> = {
      '/api/share-screenshot': () => desk.shareScreenshot(),
      '/api/start': () => desk.start(body.network ?? false), '/api/refresh': () => desk.refresh(),
      '/api/login': () => desk.login(body), '/api/cancel-login': () => desk.cancelLogin(body.id),
      '/api/chat': () => desk.chat(body.message, body.desktop === true), '/api/approve': () => desk.approve(body.id), '/api/reject': () => desk.reject(body.id),
    };
    if (!operations[path]) throw new Error('Unknown operation.');
    desk.launch(operations[path]); return { accepted: true };
  }
  async close() {
    await Promise.all([...this.desks.values()].map(desk => desk.stop()));
    await this.models.close();
    const tasks = [...this.desks.values()].flatMap(desk => [...desk.tasks]);
    if (tasks.length) {
      let timer!: ReturnType<typeof setTimeout>;
      try { await Promise.race([Promise.allSettled(tasks), new Promise<void>(done => { timer = setTimeout(done, 5000); })]); }
      finally { clearTimeout(timer); }
    }
  }
}
function website(value: unknown) { return z.string().max(2048).parse(value); }
