// Explicit live regression: uses the existing local Holo4 and disposable real VMs.
// No real account or host desktop input. All created guests are stopped in finally.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, delay } from '../src/config.ts';
import { sessionToken } from '../src/server.ts';
const token = await sessionToken(); const origin = 'http://127.0.0.1:8765';
const artifacts = join(ROOT, 'artifacts/overnight'); await mkdir(artifacts, { recursive: true });
async function convex(kind: string, path: string, args: object): Promise<any> {
  const response = await fetch('http://127.0.0.1:3210/api/' + kind, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, args: { token, ...args }, format: 'json' }), signal: AbortSignal.timeout(15000) });
  const result = await response.json(); if (result.status !== 'success') throw new Error(result.errorMessage); return result.value;
}
async function local(thread: string, path = '/api/state', body?: object): Promise<any> {
  const response = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { 'X-Local-Token': token, 'X-Halo-Thread': thread, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
}
async function done(threadId: string) {
  let lastPhase = '';
  for (let attempt = 0; attempt < 900; attempt++) {
    const workspace = await convex('query', 'workspace:list', {}); const thread = workspace.threads.find((t: any) => t._id === threadId);
    const state = await local(threadId);
    if (state.phase !== lastPhase) { console.log('Live fixture: ' + state.phase + ' · ' + state.actions + ' actions'); lastPhase = state.phase; }
    if (!thread.activeRunId && !state.busy && state.phase !== 'stopping') { if (thread.error || state.error) throw new Error(thread.error || state.error); return state; }
    await delay(1000);
  }
  throw new Error('Live fixture timed out.');
}
async function command(threadId: string, path: string, body = {}) { await convex('mutation', 'runs:command', { threadId, path, body }); return done(threadId); }
async function screenshot(thread: string, name: string) { const state = await local(thread); if (state.screen) await writeFile(join(artifacts, name), Buffer.from(state.screen.split(',')[1], 'base64')); }
let botId: string | undefined; const threads: string[] = [];
try {
  const a: string = await convex('mutation', 'workspace:createBot', { name: 'QA live TypeScript', instructions: '' }); threads.push(a);
  const workspace = await convex('query', 'workspace:list', {}); botId = workspace.threads.find((t: any) => t._id === a).botId;
  const b: string = await convex('mutation', 'workspace:createConversation', { botId, title: 'Second real VM' }); threads.push(b);
  await command(a, '/api/start', { network: false }); console.log('PASS: first real offline VM started through TypeScript.');
  await screenshot(a, 'live-offline-before.png');
  if (!process.argv.includes('--practice-only')) {
    await command(b, '/api/start', { network: false });
    assert.notEqual((await local(a)).sandbox_id, (await local(b)).sandbox_id); console.log('PASS: two real VMs have separate identities.');
    await command(b, '/api/stop'); assert.equal((await local(a)).sandbox, true); console.log('PASS: stopping the second real VM leaves the first running.');
  }
  await command(a, '/api/approval-mode', { enabled: true });
  await convex('mutation', 'runs:send', { threadId: a, text: 'Change the name to Alex, select Blue as the favourite colour, set the short note to Hello from Halo, then click Save practice note. Finish only when the saved result shows all three values.', desktop: true });
  const state = await done(a); await screenshot(a, 'live-offline-after.png');
  assert.equal(state.pending, null); assert.equal(state.task, null); assert.ok(state.messages.some((m: any) => m.role === 'assistant' && m.text.startsWith('Verified on the current screenshot')));
  console.log('PASS: real Holo4 completed and independently verified the multi-field offline practice task in ' + state.actions + ' actions.');
} catch (error) {
  for (const tid of threads) await screenshot(tid, 'live-offline-failure.png').catch(() => {});
  throw error;
} finally {
  for (const tid of threads) {
    await local(tid, '/api/stop', {}).catch(() => {});
    for (let attempt = 0; attempt < 90; attempt++) { const state = await local(tid).catch(() => null); if (!state || (!state.sandbox && state.phase === 'idle')) break; await delay(500); }
    // Reconcile Convex's sandbox status after emergency direct cleanup too.
    await command(tid, '/api/stop').catch(() => {});
  }
  if (botId) await convex('mutation', 'workspace:updateBot', { botId, name: 'QA live TypeScript', instructions: '', archived: true }).catch(() => {});
}
