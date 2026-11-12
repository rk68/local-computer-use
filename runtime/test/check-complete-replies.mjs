// Real local model + Convex. Only this temporary QA bot is modified.
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
async function current(id) { return (await convex('query', 'workspace:list', {})).threads.find(thread => thread._id === id); }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function done(id) {
  for (let attempt = 0; attempt < 900; attempt++) { const thread = await current(id); if (!thread.activeRunId) { assert.equal(thread.error, undefined); return; } await wait(200); }
  throw new Error('Text reply did not finish.');
}
const models = await (await fetch(base + '/api/models', { headers: { 'X-Local-Token': token } })).json(); assert.equal(models.ready, true);
const directory = join(root, 'artifacts/complete-replies'); await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let botId, threadId;
try {
  threadId = await convex('mutation', 'workspace:createBot', { name: 'Nova QA', instructions: '', avatar: { colour: 'lilac', style: 'orb' } });
  botId = (await current(threadId)).botId;
  const context = await browser.newContext({ viewport: { width: 1366, height: 850 } });
  await context.addInitScript(id => localStorage.setItem('halo-selected-thread', id), threadId);
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await page.getByRole('heading', { name: 'Chat with Nova QA', exact: true }).waitFor();
  await page.locator('.chat-intro').waitFor();
  await page.evaluate(() => {
    window.__replyTexts = [];
    new MutationObserver(() => window.__replyTexts.push([...document.querySelectorAll('.message.assistant p')].map(node => node.textContent).join('\n'))).observe(document.querySelector('#messages'), { childList: true, subtree: true, characterData: true });
  });
  const prompt = 'Write a 300-word welcome message for a new user of a local desktop application. Do not claim to have taken any desktop actions.';
  await page.locator('#message').fill(prompt); await page.locator('#send').click();
  await page.locator('.message.user').filter({ hasText: prompt }).waitFor();
  await page.getByText('Thinking', { exact: true }).waitFor();
  const presence = page.locator('.agent-presence');
  assert.equal(await page.locator('.message.assistant').count(), 0, 'No partial assistant bubble while thinking.');
  assert.equal(await presence.locator('.thought-dots i').count(), 3);
  const style = await presence.evaluate(element => {
    const copy = getComputedStyle(element.querySelector('.presence-copy')), label = getComputedStyle(element.querySelector('.presence-label'));
    return { background: copy.backgroundColor, border: copy.borderTopWidth, shadow: copy.boxShadow, gradient: label.backgroundImage,
      dots: getComputedStyle(element.querySelector('.thought-dots i')).backgroundColor,
      avatarAnimation: getComputedStyle(element.querySelector('.holo-character')).animationName };
  });
  assert.equal(style.background, 'rgba(0, 0, 0, 0)'); assert.equal(style.border, '0px'); assert.equal(style.shadow, 'none');
  assert.ok(style.gradient.includes('rgb(200, 166, 245)')); assert.equal(style.dots, 'rgb(200, 166, 245)'); assert.equal(style.avatarAnimation, 'halo-consider');
  await page.screenshot({ path: join(directory, 'thinking-lilac-dark.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await presence.locator('.thought-dots i').first().evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('.theme-toggle').click();
  assert.equal(await presence.locator('.thought-dots i').first().evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(80, 53, 104)');
  await page.screenshot({ path: join(directory, 'thinking-lilac-light.png') });
  await done(threadId);
  await page.locator('.agent-presence').waitFor({ state: 'hidden' });
  const answer = await page.locator('.message.assistant p').innerText(); assert.ok(answer.length > 100);
  const updates = await page.evaluate(() => window.__replyTexts.filter(text => text.trim()));
  assert.ok(updates.length); assert.ok(updates.every(text => text === answer), 'Only the complete answer may become visible.');
  console.log('PASS: no partial bubble; one complete answer, matching lilac glow/dots/avatar, no status bubble, light/dark and reduced motion.');
  await page.reload(); await page.locator('.message.assistant p').waitFor(); assert.equal(await page.locator('.message.assistant p').innerText(), answer);
  await page.locator('#message').fill('Write a very long 900-word story about a friendly robot exploring a garden.'); await page.locator('#send').click();
  await page.locator('.message.user').filter({ hasText: '900-word' }).waitFor();
  await page.getByText('Thinking', { exact: true }).waitFor();
  const stoppedRun = (await current(threadId)).activeRunId; assert.ok(stoppedRun);
  await page.getByRole('button', { name: 'Stop generating', exact: true }).click();
  await done(threadId); assert.equal(await page.locator('.message.assistant').count(), 1, 'Stopped reply must not publish partial content.');
  const late = await promisify(execFile)(process.execPath, [join(root, 'web/node_modules/.bin/convex'), 'run', 'workspace:completeText', JSON.stringify({ runId: stoppedRun, text: 'LATE REPLY MUST NEVER APPEAR' })], { cwd: join(root, 'web'), env: { ...process.env, CONVEX_AGENT_MODE: 'anonymous' } });
  assert.equal(late.stdout.trim(), 'false'); assert.equal(await page.locator('#messages').innerText().then(text => text.includes('LATE REPLY')), false);
  await page.locator('#message').fill('hello'); await page.locator('#send').click(); await page.locator('.message.user').filter({ hasText: 'hello' }).waitFor();
  await done(threadId); await page.waitForFunction(() => document.querySelectorAll('.message.assistant').length === 2);
  assert.deepEqual(errors, []); console.log('PASS: durable complete reply, cancellation, late-result fencing, and a subsequent greeting.');
} finally {
  if (threadId) { if ((await current(threadId))?.activeRunId) await convex('mutation', 'workspace:cancel', { threadId }).catch(() => {}); await done(threadId).catch(() => {}); }
  if (botId) await convex('mutation', 'workspace:updateBot', { botId, name: 'QA complete replies', instructions: '', archived: true });
  await browser.close();
}
