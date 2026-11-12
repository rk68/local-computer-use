// Real local Convex, isolated Chrome profile, no model or sandbox required.
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = join(root, 'artifacts/avatars'); await mkdir(directory, { recursive: true });
const base = 'http://127.0.0.1:8765';
const { token } = await (await fetch(base + '/api/session')).json();
async function convex(kind, path, args) {
  const response = await fetch('http://127.0.0.1:3210/api/' + kind, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, args: { token, ...args }, format: 'json' }) });
  const value = await response.json(); if (value.status !== 'success') throw new Error(value.errorMessage); return value.value;
}
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let botId;
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await page.locator('#message').waitFor();
  await page.getByRole('button', { name: 'Create bot', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Meet your next bot' });
  const name = 'Nova QA ' + Date.now();
  await dialog.getByLabel('Bot name', { exact: true }).fill(name);
  await dialog.locator('label').filter({ has: page.getByRole('radio', { name: 'Lilac', exact: true }) }).click();
  await dialog.getByRole('radio', { name: 'Lilac', exact: true }).press('ArrowRight');
  assert.equal(await dialog.getByRole('radio', { name: 'Mint', exact: true }).isChecked(), true);
  await dialog.getByRole('radio', { name: 'Mint', exact: true }).press('ArrowLeft');
  await dialog.locator('label').filter({ has: page.getByRole('radio', { name: 'Orb', exact: true }) }).click();
  assert.equal(await dialog.locator('.avatar-preview .holo-avatar').getAttribute('data-colour'), 'lilac');
  assert.equal(await dialog.locator('.avatar-preview .holo-avatar').getAttribute('data-style'), 'orb');
  await page.screenshot({ path: join(directory, 'create-lilac-orb.png') });
  await dialog.getByRole('button', { name: 'Create bot', exact: true }).click();
  await page.getByRole('heading', { name: 'Chat with ' + name, exact: true }).waitFor();
  let workspace = await convex('query', 'workspace:list', {});
  const bot = workspace.bots.find(bot => bot.name === name); botId = bot._id;
  assert.deepEqual(bot.avatar, { colour: 'lilac', style: 'orb' });
  const thread = workspace.threads.find(thread => thread.botId === botId);
  for (const selector of ['.chat-panel .panel-heading .holo-avatar', '.welcome-character .holo-avatar']) {
    assert.equal(await page.locator(selector).getAttribute('data-colour'), 'lilac');
    assert.equal(await page.locator(selector).getAttribute('data-style'), 'orb');
  }
  const group = page.locator('.bot-group').filter({ has: page.getByRole('button', { name: 'Edit ' + name, exact: true }) });
  assert.equal(await group.locator('.bot-group-heading .holo-avatar').getAttribute('data-colour'), 'lilac');
  await page.reload(); await page.getByRole('heading', { name: 'Chat with ' + name, exact: true }).waitFor();
  assert.equal(await page.locator('.welcome-character .holo-avatar').getAttribute('data-style'), 'orb');
  await page.locator('.theme-toggle').click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  await page.getByRole('button', { name: 'Edit ' + name, exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Bot settings' });
  assert.equal(await settings.getByRole('radio', { name: 'Lilac', exact: true }).isChecked(), true);
  assert.equal(await settings.getByRole('radio', { name: 'Orb', exact: true }).isChecked(), true);
  await settings.getByLabel('Bot name', { exact: true }).fill('Mochi QA');
  await settings.locator('label').filter({ has: page.getByRole('radio', { name: 'Mint', exact: true }) }).click();
  await settings.locator('label').filter({ has: page.getByRole('radio', { name: 'Pixel', exact: true }) }).click();
  assert.equal(await settings.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(255, 255, 255)');
  await page.screenshot({ path: join(directory, 'edit-mint-pixel-light.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const rect = await settings.boundingBox(); assert.ok(rect.x >= 0 && rect.x + rect.width <= 391);
  await page.screenshot({ path: join(directory, 'edit-avatar-mobile.png') });
  await settings.getByRole('button', { name: 'Save bot', exact: true }).click();
  await page.getByRole('heading', { name: 'Chat with Mochi QA', exact: true }).waitFor();
  workspace = await convex('query', 'workspace:list', {});
  assert.deepEqual(workspace.bots.find(bot => bot._id === botId).avatar, { colour: 'mint', style: 'pixel' });
  await convex('mutation', 'workspace:updateBot', { botId, name: 'Mochi QA', instructions: 'Appearance must survive unrelated settings changes.' });
  assert.deepEqual((await convex('query', 'workspace:list', {})).bots.find(bot => bot._id === botId).avatar, { colour: 'mint', style: 'pixel' });
  await assert.rejects(convex('mutation', 'workspace:updateBot', { botId, name: 'Mochi QA', instructions: '', avatar: { colour: 'not-a-colour', style: 'pixel' } }));
  await assert.rejects(convex('mutation', 'workspace:createBot', { name: 'Invalid avatar', instructions: '', avatar: { colour: 'mint', style: 'not-a-style' } }));
  // Render active status without inference.
  await page.route('**/api/state', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ phase: 'thinking', busy: true, error: null, sandbox: false, sandbox_id: null, messages: [], events: [], pending: null, screen: null, width: 0, height: 0, actions: 0, max_actions: 20, approve_all: false, network: false, browser_origin: null, credential_request: null, task: null }) }));
  await page.locator('.agent-presence .holo-avatar[data-colour="mint"][data-style="pixel"]').waitFor();
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.screenshot({ path: join(directory, 'custom-bot-presence.png') });
  assert.deepEqual(errors, []);
  console.log('PASS: live avatar preview, named bot creation, colour/style persistence, sidebar/chat/welcome/status avatars, rename/edit, unrelated-update preservation, invalid-choice rejection, mobile and light/dark UI.');
} finally {
  if (botId) await convex('mutation', 'workspace:updateBot', { botId, name: 'QA avatar customisation', instructions: '', archived: true });
  await browser.close();
}
