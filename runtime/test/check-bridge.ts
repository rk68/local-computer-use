// Requires the project's local Convex and a free executor port. No model or VM.
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Runtime } from '../src/runtime.ts';
import { createApp, sessionToken } from '../src/server.ts';
import { FakeGuest, tool } from './fixtures.ts';
import { ROOT, delay } from '../src/config.ts';

const directory = await mkdtemp(join(tmpdir(), 'halo-bridge-'));
const token = await sessionToken();
const runtime = new Runtime({ screenshots: join(directory, 'screenshots'), owned: join(directory, 'legacy.json'), wait: async () => {}, factory: {
  create: async name => new FakeGuest('local:' + name), recover: async () => {},
}, request: async () => tool('desktop_click', { x: 500, y: 500, reason: 'Fixture target' }) });
// A prior interrupted fixture may leave a run, but never a real guest.
const previousWorkspace = await convex('query', 'workspace:list', {});
for (const bot of previousWorkspace.bots.filter((bot: any) => bot.name.startsWith('QA TypeScript bridge '))) {
  for (const thread of previousWorkspace.threads.filter((thread: any) => thread.botId === bot._id)) await convex('mutation', 'workspace:syncExecutorState', { threadId: thread._id, sandbox: false, phase: 'idle' });
  await convex('mutation', 'workspace:updateBot', { botId: bot._id, name: 'QA TypeScript bridge', instructions: '', archived: true });
}
const server = createApp(runtime, token);
server.listen(8765, '127.0.0.1'); await once(server, 'listening');
async function convex(kind: string, path: string, args: object): Promise<any> {
  const response = await fetch('http://127.0.0.1:3210/api/' + kind, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, args: { token, ...args }, format: 'json' }), signal: AbortSignal.timeout(10000) });
  const value = await response.json(); if (value.status !== 'success') throw new Error(value.errorMessage ?? 'Convex request failed.'); return value.value;
}
async function done(threadId: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const workspace = await convex('query', 'workspace:list', {}); const thread = workspace.threads.find((t: any) => t._id === threadId);
    if (!thread.activeRunId) return thread; await delay(100);
  }
  throw new Error('Run did not finish.');
}
async function command(threadId: string, path: string, body = {}) { await convex('mutation', 'runs:command', { threadId, path, body }); return done(threadId); }
let botId: string | undefined; let a: string | undefined; let b: string | undefined;
try {
  a = await convex('mutation', 'workspace:createBot', { name: 'QA TypeScript bridge ' + Date.now(), instructions: 'Fixture only.' });
  botId = (await convex('query', 'workspace:list', {})).threads.find((t: any) => t._id === a).botId;
  b = await convex('mutation', 'workspace:createConversation', { botId, title: 'Other fixture desktop' });
  assert.equal(runtime.resolve(a!).sb, null); assert.equal(runtime.resolve(b!).sb, null);
  assert.ok(!(await command(a!, '/api/start', { network: false })).error); assert.ok(!(await command(b!, '/api/start', { network: false })).error);
  const first = runtime.resolve(a!), second = runtime.resolve(b!); assert.notEqual(first.sb!.id, second.sb!.id);
  await convex('mutation', 'runs:send', { threadId: a, text: 'Click the fixture target', desktop: true }); await done(a!);
  const approval = first.pending!.id;
  assert.ok((await command(b!, '/api/approve', { id: approval })).error); assert.equal(first.pending!.id, approval);
  assert.ok(!(await command(a!, '/api/approve', { id: approval })).error);
  assert.equal(first.actions, 1); assert.equal(second.actions, 0);
  await command(a!, '/api/reject', { id: first.pending!.id });
  // Public fixture pixels, never a host desktop or account screenshot.
  const { PNG } = createRequire(import.meta.url)('pngjs');
  const bitmap = new PNG({ width: 1280, height: 800 });
  for (let y = 0; y < 800; y++) for (let x = 0; x < 1280; x++) {
    const i = (y * 1280 + x) * 4, tile = x > 200 && x < 1080 && y > 180 && y < 620;
    bitmap.data[i] = tile ? 226 : 245; bitmap.data[i + 1] = tile ? 157 : 245; bitmap.data[i + 2] = tile ? 64 : 245; bitmap.data[i + 3] = 255;
  }
  const fixturePng = PNG.sync.write(bitmap);
  first.sb!.screenshot = async () => ({ png: fixturePng, width: 1280, height: 800 });
  assert.ok(!(await command(a!, '/api/share-screenshot')).error);
  const images = await convex('query', 'workspace:screenshots', { threadId: a });
  assert.equal(images.length, 1); assert.match(images[0].id, /^[a-f0-9]{32}$/);
  assert.equal((await convex('query', 'workspace:screenshots', { threadId: b })).length, 0);
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 850 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(id => { localStorage.setItem('halo-selected-thread', id); localStorage.setItem('holo-desktop-visible', 'true'); }, a!);
    await page.goto('http://127.0.0.1:8765');
    await page.locator('.screenshot-preview img').waitFor({ timeout: 12000 }).catch(async error => { console.log('UI capture debug:', await page.locator('body').innerText(), errors); await page.screenshot({ path: join(ROOT, 'artifacts/followup-debug.png') }); throw error; });
    await page.waitForFunction(() => (document.querySelector('.screenshot-preview img') as HTMLImageElement)?.naturalWidth === 1280);
    assert.equal(await page.locator('.task-activity').count(), 1);
    await page.locator('.task-activity summary').click();
    assert.ok(await page.locator('.task-activity li').count() > 1);
    await page.getByRole('button', { name: 'Expand shared screenshot', exact: true }).click();
    await page.getByRole('dialog', { name: 'Shared screenshot', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    const download = page.waitForEvent('download'); await page.getByRole('link', { name: 'Save PNG', exact: true }).click();
    assert.match((await download).suggestedFilename(), /^halo-.*\.png$/);
    await page.reload(); await page.locator('.screenshot-preview img').waitFor();
    await page.waitForFunction(() => (document.querySelector('.screenshot-preview img') as HTMLImageElement)?.naturalWidth === 1280);
    await mkdir(join(ROOT, 'artifacts/followup'), { recursive: true });
    await page.locator('#messages').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.screenshot({ path: join(ROOT, 'artifacts/followup/shared-screenshot-dark.png') });
    await page.locator('.theme-toggle').click(); await page.screenshot({ path: join(ROOT, 'artifacts/followup/shared-screenshot-light.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Close virtual desktop', exact: true }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(ROOT, 'artifacts/followup/shared-screenshot-mobile.png') });
    await page.route('**/api/state', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...first.snapshot(), busy: true, phase: 'verifying task' }) }));
    await page.getByText('Checking the result', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.presence-elapsed')?.textContent === '1s');
    await page.screenshot({ path: join(ROOT, 'artifacts/followup/checking-result-mobile.png') });
    assert.deepEqual(errors, []);
    console.log('PASS: screenshot appears in real Convex chat, survives reload, expands, downloads PNG, remains thread scoped; compact action trail, timed verification, dark/light/mobile UI.');
  } finally { await browser.close(); }
  await command(a!, '/api/stop'); assert.equal(first.sb, null); assert.ok(second.sb);
  await command(b!, '/api/stop');
  console.log('PASS: real Convex → TypeScript HTTP executor → two fake guests; isolated ownership, approvals, action counts, transcript monitoring, and stop.');
} finally {
  for (const tid of [a, b]) if (tid && runtime.resolve(tid).sb) await command(tid, '/api/stop').catch(() => {});
  if (botId) await convex('mutation', 'workspace:updateBot', { botId, name: 'QA TypeScript bridge', instructions: '', archived: true }).catch(() => {});
  server.close(); server.closeAllConnections(); await runtime.close(); await rm(directory, { recursive: true, force: true });
}
