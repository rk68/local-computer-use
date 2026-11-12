// Real Holo4, local Convex, and a disposable online guest. No account login.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, delay } from '../src/config.ts';
import { sessionToken } from '../src/server.ts';
const token = await sessionToken();
async function local(path: string, body?: object, threadId?: string): Promise<any> {
  const response = await fetch('http://127.0.0.1:8765' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Local-Token': token, ...(threadId ? { 'X-Halo-Thread': threadId } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
}
async function convex(kind: string, path: string, args: object): Promise<any> {
  const response = await fetch('http://127.0.0.1:3210/api/' + kind, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, args: { token, ...args }, format: 'json' }) });
  const result = await response.json(); if (result.status !== 'success') throw new Error(result.errorMessage); return result.value;
}
async function done(threadId: string) {
  let phase = '';
  for (let attempt = 0; attempt < 600; attempt++) {
    const state = await local('/api/state', undefined, threadId);
    if (state.phase !== phase) { phase = state.phase; console.log('Live visual: ' + phase + ' · ' + state.actions + ' actions'); }
    const workspace = await convex('query', 'workspace:list', {}), thread = workspace.threads.find((thread: any) => thread._id === threadId);
    if (!thread.activeRunId && !state.busy && state.phase !== 'stopping') {
      if (state.error || thread.error) throw new Error(state.error || thread.error); return state;
    }
    await delay(1000);
  }
  throw new Error('Live visual task timed out.');
}
async function command(threadId: string, path: string, body = {}) { await convex('mutation', 'runs:command', { threadId, path, body }); return done(threadId); }
let threadId: string | undefined, botId: string | undefined, modelStarted = false;
try {
  const initial = await local('/api/models'); assert.equal(initial.ready, false); assert.equal(initial.phase, 'off');
  await local('/api/model/start', { id: 'holo4-35b-a3b' }); modelStarted = true;
  for (let attempt = 0; ; attempt++) {
    const model = await local('/api/models'); if (model.ready && model.phase === 'ready') break;
    if (model.phase === 'failed' || attempt > 240) throw new Error('Test model failed to load.'); await delay(1000);
  }
  threadId = await convex('mutation', 'workspace:createBot', { name: 'QA live image selection', instructions: '' });
  const workspace = await convex('query', 'workspace:list', {}); botId = workspace.threads.find((thread: any) => thread._id === threadId).botId;
  await command(threadId!, '/api/start', { network: true });
  await command(threadId!, '/api/approval-mode', { enabled: true });
  await convex('mutation', 'runs:send', { threadId, desktop: true, text: (process.argv.includes('--commons') ? 'Open https://commons.wikimedia.org/wiki/Category:Red_cats . Pick' : 'Open https://www.google.com/search?q=orange+cat&udm=2 . Pick') + ' one photograph of an orange cat, open its larger preview, and share a screenshot in this chat with desktop_share_screenshot. A search results grid alone is not the selected result. Do not sign in.' });
  const state = await done(threadId!);
  const directory = join(ROOT, 'artifacts/followup'); await mkdir(directory, { recursive: true });
  if (state.screen) await writeFile(join(directory, 'live-selected-cat.png'), Buffer.from(state.screen.split(',')[1], 'base64'));
  assert.equal(state.pending, null); assert.equal(state.credential_request, null);
  console.log('Final live response:', state.messages.filter((message: any) => message.role === 'assistant').slice(-2).map((message: any) => message.text).join(' | '));
  assert.ok(state.messages.some((message: any) => message.text.startsWith('Verified on the current screenshot')));
  const images = await convex('query', 'workspace:screenshots', { threadId }); assert.ok(images.length);
  const response = await fetch('http://127.0.0.1:8765/api/artifacts/' + images.at(-1).id, { headers: { 'X-Local-Token': token, 'X-Halo-Thread': threadId! } }); assert.equal(response.status, 200);
  console.log('PASS: real Holo4 selected an orange cat, independently verified it, and saved a chat screenshot through Convex in ' + state.actions + ' actions.');
} finally {
  if (threadId) {
    const state = await local('/api/state', undefined, threadId).catch(() => null);
    if (state?.screen) { await mkdir(join(ROOT, 'artifacts/followup'), { recursive: true }); await writeFile(join(ROOT, 'artifacts/followup/live-visual-last.png'), Buffer.from(state.screen.split(',')[1], 'base64')); }
    await local('/api/stop', {}, threadId).catch(() => {});
    for (let attempt = 0; attempt < 90; attempt++) { const state = await local('/api/state', undefined, threadId); if (!state.sandbox && state.phase === 'idle' && !state.busy) break; await delay(500); }
    await command(threadId, '/api/stop').catch(() => {});
    if (botId) await convex('mutation', 'workspace:updateBot', { botId, name: 'QA live image selection', instructions: '', archived: true });
  }
  if (modelStarted) await local('/api/model/stop', {}).catch(() => {});
}
