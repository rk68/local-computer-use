// Use the already-running model. Seed only a temporary QA thread, never user history.
import { chromium } from 'playwright-core';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url)), base = 'http://127.0.0.1:8765';
const { token } = await (await fetch(base + '/api/session')).json();
async function convex(kind, path, args) {
  const response = await fetch('http://127.0.0.1:3210/api/' + kind, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, args: { token, ...args }, format: 'json' }) });
  const value = await response.json(); if (value.status !== 'success') throw new Error(value.errorMessage); return value.value;
}
const models = await (await fetch(base + '/api/models', { headers: { 'X-Local-Token': token } })).json(); assert.equal(models.ready, true);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let botId, threadId;
try {
  threadId = await convex('mutation', 'workspace:createBot', { name: 'QA greeting after desktop', instructions: 'Keep conversational replies brief.' });
  const workspace = await convex('query', 'workspace:list', {}), thread = workspace.threads.find(thread => thread._id === threadId); botId = thread.botId;
  const seed = {
    threadId: thread.agentThreadId,
    messages: [
      { message: { role: 'user', content: 'Save the practice form.' } },
      { message: { role: 'assistant', content: 'Running the next action in the sandbox: Save the practice form' } },
      { message: { role: 'system', content: 'Action sent to the guest. Inspecting the new screenshot.' } },
      { message: { role: 'assistant', content: 'The fixture form is saved.' } },
    ],
  };
  await promisify(execFile)(process.execPath, [join(root, 'web/node_modules/.bin/convex'), 'run', '--component', 'agent', 'messages:addMessages', JSON.stringify(seed)], { cwd: join(root, 'web'), env: { ...process.env, CONVEX_AGENT_MODE: 'anonymous' } });
  const context = await browser.newContext({ viewport: { width: 1366, height: 850 } });
  await context.addInitScript(id => localStorage.setItem('halo-selected-thread', id), threadId);
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await page.getByRole('heading', { name: 'Chat with QA greeting after desktop', exact: true }).waitFor();
  await page.getByText('The fixture form is saved.', { exact: true }).waitFor();
  let expectedReplies = 0;
  for (const greeting of ['hello', 'How are you?']) {
    const before = await page.locator('.message.assistant').count();
    await page.locator('#message').fill(greeting); await page.locator('#send').click();
    await page.locator('.message.user').filter({ hasText: greeting }).last().waitFor();
    await page.waitForFunction(count => document.querySelectorAll('.message.assistant').length > count, before, { timeout: 120000 });
    await page.waitForFunction(() => [...document.querySelectorAll('.message.assistant')].at(-1)?.querySelector('p')?.textContent?.trim().length > 0, undefined, { timeout: 120000 });
    let finished = false;
    for (let attempt = 0; attempt < 600; attempt++) {
      const state = await convex('query', 'workspace:list', {}), current = state.threads.find(thread => thread._id === threadId);
      if (!current.activeRunId) { assert.equal(current.error, undefined); finished = true; break; }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(finished, 'Greeting run did not finish.');
    await page.waitForFunction(count => document.querySelectorAll('.message.assistant').length > count, before, { timeout: 15000 });
    await page.waitForFunction(() => [...document.querySelectorAll('.message.assistant')].at(-1)?.querySelector('p')?.textContent?.trim().length > 0, undefined, { timeout: 15000 });
    const reply = (await page.locator('.message.assistant').last().locator('p').allTextContents()).join('\n'); assert.ok(reply.trim());
    expectedReplies = await page.locator('.message.assistant').count();
    console.log('PASS: real model replied to ' + JSON.stringify(greeting) + ' after interleaved desktop status history.');
  }
  await page.reload(); await page.getByRole('heading', { name: 'Chat with QA greeting after desktop', exact: true }).waitFor();
  await page.waitForFunction(count => document.querySelectorAll('.message.assistant').length >= count, expectedReplies, { timeout: 15000 });
  assert.ok(expectedReplies >= 3); assert.deepEqual(errors, []);
  await mkdir(join(root, 'artifacts/greeting'), { recursive: true }); await page.screenshot({ path: join(root, 'artifacts/greeting/live-hello.png') });
  console.log('PASS: replies remain visible after reload; no VM started or existing model unloaded.');
} finally {
  if (threadId) {
    const state = await convex('query', 'workspace:list', {}), thread = state.threads.find(thread => thread._id === threadId);
    if (thread?.activeRunId) { await convex('mutation', 'workspace:cancel', { threadId }).catch(() => {}); }
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await convex('query', 'workspace:list', {}), current = state.threads.find(thread => thread._id === threadId);
      if (!current?.activeRunId) break; await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  if (botId) await convex('mutation', 'workspace:updateBot', { botId, name: 'QA greeting after desktop', instructions: '', archived: true });
  await browser.close();
}
