// Starts the already-downloaded local model from the real UI, then unloads it.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:8765';
const { token } = await (await fetch(base + '/api/session')).json();
const local = async (path, body) => { const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'X-Local-Token': token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); const v = await r.json(); if (!r.ok) throw new Error(v.error); return v; };
async function convex(kind, path, args) {
  const r = await fetch('http://127.0.0.1:3210/api/' + kind, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, args: { token, ...args }, format: 'json' }) });
  const v = await r.json(); if (v.status !== 'success') throw new Error(v.errorMessage); return v.value;
}
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let botId, threadId; let guard = false;
try {
  const initial = await local('/api/models'); assert.equal(initial.phase, 'off'); assert.equal(initial.managed, false);
  const first = await convex('mutation', 'workspace:createBot', { name: 'QA managed model', instructions: 'Reply concisely.' });
  let w = await convex('query', 'workspace:list', {}); botId = w.threads.find(t => t._id === first).botId;
  threadId = await convex('mutation', 'workspace:createConversation', { botId, title: 'Managed model check' });
  await convex('mutation', 'workspace:modelControl', { changing: true }); guard = true;
  await assert.rejects(convex('mutation', 'runs:send', { threadId, text: 'This must be refused while a model changes.', desktop: false }), /finish loading or unloading/);
  await convex('mutation', 'workspace:modelControl', { changing: false }); guard = false;
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto(base); await page.locator('#message').waitFor();
  await page.getByRole('button', { name: 'Choose local model', exact: true }).click();
  await page.locator('.model-choice').first().getByRole('button', { name: 'Use model', exact: true }).click();
  for (let attempt = 0; attempt < 360; attempt++) {
    const state = await local('/api/models'); if (state.phase === 'failed') throw new Error(state.error);
    if (state.phase === 'ready' && state.ready && state.managed) break;
    if (attempt === 359) throw new Error('Managed model did not become ready.');
    await new Promise(done => setTimeout(done, 1000));
  }
  console.log('PASS: model loaded through the real UI; owned llama.cpp process and Convex model-change guard.');
  await page.getByRole('button', { name: 'Close model picker', exact: true }).click();
  await page.getByRole('button', { name: 'Managed model check', exact: true }).click();
  await page.locator('#message').fill('Reply with exactly HALO_READY.'); await page.locator('#send').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.message.assistant')].some(m => m.textContent.includes('HALO_READY')), undefined, { timeout: 180000 });
  await page.getByRole('button', { name: 'Stop generating', exact: true }).waitFor({ state: 'hidden', timeout: 180000 });
  console.log('PASS: app-managed Holo4 inference streamed through real Convex into the UI.');
  await page.getByRole('button', { name: 'Choose local model', exact: true }).click();
  await page.getByRole('button', { name: 'Unload model', exact: true }).click();
  let final;
  for (let attempt = 0; attempt < 100; attempt++) {
    final = await local('/api/models'); if (final.phase === 'off' && !final.managed && !final.ready) break;
    await new Promise(done => setTimeout(done, 200));
  }
  assert.equal(final.phase, 'off'); assert.equal(final.managed, false); assert.equal(final.ready, false);
  console.log('PASS: UI unload stopped the owned model and released its memory.');
} finally {
  if (guard) await convex('mutation', 'workspace:modelControl', { changing: false }).catch(() => {});
  if (threadId) {
    await convex('mutation', 'workspace:cancel', { threadId }).catch(() => {});
    for (let attempt = 0; attempt < 100; attempt++) { const w = await convex('query', 'workspace:list', {}); if (!w.threads.find(t => t._id === threadId)?.activeRunId) break; await new Promise(done => setTimeout(done, 100)); }
  }
  await local('/api/model/stop', {}).catch(() => {});
  if (botId) await convex('mutation', 'workspace:updateBot', { botId, name: 'QA managed model', instructions: '', archived: true }).catch(() => {});
  await browser.close();
}
