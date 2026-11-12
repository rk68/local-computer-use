// Uses a fresh browser profile and a temporary QA bot in real local Convex.
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = join(root, 'artifacts/overnight'); await mkdir(artifacts, { recursive: true });
const base = 'http://127.0.0.1:8765';
const { token } = await (await fetch(base + '/api/session')).json();
async function convex(kind, path, args) {
  const response = await fetch('http://127.0.0.1:3210/api/' + kind, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, args: { token, ...args }, format: 'json' }) });
  const value = await response.json(); if (value.status !== 'success') throw new Error(value.errorMessage); return value.value;
}
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let botId;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await page.locator('#message').waitFor();
  assert.equal(await page.locator('main > header, .breadcrumb, .local-note').count(), 0);
  assert.equal(await page.locator('.sidebar-footer #model-check').count(), 1);
  assert.equal(await page.locator('.sidebar-footer .theme-toggle').count(), 1);
  assert.equal(await page.locator('.theme-toggle').innerText(), '');
  await page.getByRole('button', { name: 'Create bot', exact: true }).click();
  const name = 'QA overnight ' + Date.now();
  await page.getByLabel('Bot name', { exact: true }).fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Create bot', exact: true }).click();
  await page.getByRole('heading', { name: 'Chat with ' + name, exact: true }).waitFor();
  let workspace = await convex('query', 'workspace:list', {}); botId = workspace.bots.find(b => b.name === name)._id;
  await page.getByRole('button', { name: 'Edit ' + name, exact: true }).click();
  await page.getByLabel('Saved memory', { exact: false }).fill('My fixture preference is ORCHID.');
  await page.getByRole('button', { name: 'Save bot', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  workspace = await convex('query', 'workspace:list', {}); assert.equal(workspace.bots.find(b => b._id === botId).memory, 'My fixture preference is ORCHID.');
  await page.getByRole('button', { name: 'New thread for ' + name, exact: true }).click();
  await page.getByRole('dialog').getByLabel('Thread title', { exact: true }).fill('Fixture second thread');
  await page.getByRole('button', { name: 'Create thread', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Thread settings: Fixture second thread', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Thread title', { exact: true }).fill('Fixture renamed thread');
  await page.getByRole('button', { name: 'Save thread', exact: true }).click();
  await page.getByRole('button', { name: 'Thread settings: Fixture renamed thread', exact: true }).click();
  await page.getByRole('button', { name: 'Archive thread', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.locator('.archived-items > summary').click();
  await page.locator('.archived-row').filter({ hasText: 'Fixture renamed thread' }).getByRole('button', { name: 'Restore thread', exact: true }).click();
  await page.getByRole('button', { name: 'Thread settings: Fixture renamed thread', exact: true }).waitFor();
  const toggle = page.getByRole('button', { name: 'Show virtual desktop', exact: true }); if (await toggle.count()) await toggle.click();
  for (const [width, height] of [[1440, 900], [1366, 768], [1280, 800]]) {
    await page.setViewportSize({ width, height });
    const footer = await page.locator('.sidebar-footer').boundingBox(); assert.ok(footer);
    assert.ok(footer.y + footer.height >= height - 36, 'App controls are not at the sidebar bottom.');
    const panel = await page.locator('#desktop-sidebar').boundingBox(); assert.ok(panel);
    assert.ok(Math.abs(panel.y + panel.height - height) <= 1, 'Desktop divider does not reach the viewport bottom.');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
    await page.screenshot({ path: join(artifacts, `halo-dark-${width}.png`) });
  }
  const avatar = page.locator('.welcome-character .holo-avatar'); const bounds = await avatar.boundingBox();
  assert.ok(bounds); await page.mouse.move(bounds.x + bounds.width + 30, bounds.y + 10);
  await page.waitForFunction(() => Number(document.querySelector('.welcome-character .holo-avatar').style.getPropertyValue('--look-x')) > 0);
  await page.getByRole('button', { name: 'Choose local model', exact: true }).click();
  await page.getByRole('heading', { name: 'Choose your model', exact: true }).waitFor();
  assert.equal(await page.locator('.model-choice').count(), 5);
  await page.getByText('Holo 3.1 · 0.8B', { exact: true }).waitFor();
  await page.getByText('Holo 3.1 · 4B', { exact: true }).waitFor();
  await page.getByText('Holo 3.1 · 9B', { exact: true }).waitFor();
  await page.getByText('CC BY-NC 4.0 · non-commercial', { exact: true }).waitFor();
  await page.screenshot({ path: join(artifacts, 'halo-model-picker.png') });
  await page.getByRole('button', { name: 'Close model picker', exact: true }).click();
  const theme = page.locator('.theme-toggle'); await theme.click();
  await page.screenshot({ path: join(artifacts, 'halo-light-1280.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile horizontal overflow');
  await page.getByRole('button', { name: 'Choose local model', exact: true }).click();
  await page.getByRole('heading', { name: 'Choose your model', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close model picker', exact: true }).click();
  await page.screenshot({ path: join(artifacts, 'halo-mobile.png') });
  await page.getByRole('button', { name: 'Close virtual desktop', exact: true }).click();
  await page.screenshot({ path: join(artifacts, 'halo-mobile-chat.png') });
  await page.setViewportSize({ width: 1366, height: 768 });
  // The private form gets controlled local responses. No dummy secret is sent
  // to Convex or an actual website by this UI-only form check.
  let privateState = { phase: 'awaiting private login', busy: false, error: null, sandbox: true, sandbox_id: 'fixture-only', messages: [], events: [], pending: null, screen: null, width: 1280, height: 800, actions: 0, max_actions: 20, approve_all: false, network: true, browser_origin: 'https://example.test', credential_request: { id: 'fixture-login', origin: 'https://example.test', reason: 'Dummy form test', kind: 'password' }, task: null };
  const privateBodies = [];
  await page.route('**/api/state', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(privateState) }));
  await page.route('**/api/accounts', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ accounts: ['Work', 'Personal'] }) }));
  await page.route('**/api/login', route => { privateBodies.push(route.request().postDataJSON()); return route.fulfill({ contentType: 'application/json', body: '{"accepted":true}' }); });
  await page.getByLabel('Email or username', { exact: true }).waitFor();
  await page.getByLabel('Email or username', { exact: true }).fill('fixture@example.test');
  await page.getByLabel('Password', { exact: true }).fill('FIXTURE-ONLY-SECRET');
  await page.getByLabel('Save in macOS Keychain', { exact: true }).check();
  await page.getByLabel('Account label', { exact: false }).fill('Work');
  await page.getByRole('button', { name: 'Fill private fields', exact: true }).click();
  assert.equal(privateBodies[0].account, 'Work'); assert.equal(privateBodies[0].remember, true); assert.equal(privateBodies[0].password, 'FIXTURE-ONLY-SECRET');
  assert.equal(await page.locator('#messages').textContent().then(text => text.includes('FIXTURE-ONLY-SECRET')), false);
  privateState = { ...privateState, credential_request: { id: 'fixture-code', origin: 'https://example.test', reason: 'Dummy code test', kind: 'code' } };
  await page.getByLabel('Verification code', { exact: true }).waitFor();
  await page.getByLabel('Verification code', { exact: true }).fill('483921');
  await page.screenshot({ path: join(artifacts, 'halo-private-code.png') });
  await page.getByRole('button', { name: 'Fill private code', exact: true }).click();
  assert.equal(privateBodies[1].code, '483921'); assert.equal('remember' in privateBodies[1], false);
  assert.deepEqual(errors, []);
  console.log('PASS: real Convex bot/memory, thread creation/rename/archive/restore, model picker, pointer gaze, three laptop sizes, light/dark, mobile, full-height divider, private named-account/code forms, no page errors.');
} finally {
  if (botId) await convex('mutation', 'workspace:updateBot', { botId, name: 'QA overnight', instructions: '', memory: '', archived: true });
  await browser.close();
}
