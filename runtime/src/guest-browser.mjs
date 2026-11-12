// Runs only INSIDE the disposable online guest. Never drives the host browser.
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { readFile, writeFile, unlink, rename, access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const PRIVATE = '/dev/shm/holo-private';
const sleep = ms => new Promise(done => setTimeout(done, ms));
delete process.env.DEBUG;
process.env.PWDEBUG = '0';
const ipv4 = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) ipv4.addSubnet(address, prefix, 'ipv4');
const ipv6Global = new BlockList(); ipv6Global.addSubnet('2000::', 3, 'ipv6');
const ipv6Reserved = new BlockList();
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) ipv6Reserved.addSubnet(address, prefix, 'ipv6');
const nat64 = new BlockList(); nat64.addSubnet('64:ff9b::', 96, 'ipv6');
export function publicAddress(address) {
  const version = isIP(address);
  // The QEMU gateway returns well-known DNS64 addresses alongside IPv4.
  // Classify the embedded destination, rather than rejecting all translated
  // public sites or accidentally allowing translated private/loopback targets.
  if (version === 6 && nat64.check(address, 'ipv6')) {
    const parts = address.split(':'); const low = parts.at(-1);
    if (low.includes('.')) return publicAddress(low);
    const highWord = parseInt(parts.at(-2) || '0', 16), lowWord = parseInt(low || '0', 16);
    return publicAddress([highWord >> 8, highWord & 255, lowWord >> 8, lowWord & 255].join('.'));
  }
  return version === 4 ? !ipv4.check(address, 'ipv4') : version === 6 && ipv6Global.check(address, 'ipv6') && !ipv6Reserved.check(address, 'ipv6');
}
export async function publicUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    const answers = await lookup(url.hostname, { all: true });
    return answers.length > 0 && answers.every(answer => publicAddress(answer.address));
  } catch { return false; }
}
export function secretMatcher(value) {
  const escaped = [...value.slice(0, 128)].map(char => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('[\\s\\u200b\\u200c\\u200d\\ufeff]*'), 'gi');
}
export function containsClosedShadow(value) {
  if (!value || typeof value !== 'object') return false;
  return value.shadowRootType === 'closed' || Object.values(value).some(containsClosedShadow);
}
export class PrivacyBlocked extends Error {}
export class PrivateLoginRequired extends Error {}
export class CaptureFailed extends Error {}
async function guardPrivateInput(page) {
  const focused = page.locator(':focus');
  if (await focused.count() && await focused.evaluate(el => el.tagName === 'INPUT' && (el.type === 'password' || ['username', 'one-time-code'].includes(el.autocomplete) || /^(otp|code|verification_code)$/i.test(el.name) || (['text', 'email'].includes(el.type) && !!document.querySelector('input[type=password]'))))) throw new PrivateLoginRequired();
}
export async function prepareContext(browser) {
  const oldPages = browser.contexts().flatMap(context => context.pages());
  const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
  await context.routeWebSocket('**/*', connection => connection.close());
  await context.newPage();
  for (const page of oldPages) await page.close();
  return context;
}
const controllers = new WeakMap();
async function configureDownloads(browser, context, page, downloadPath) {
  if (controllers.has(context)) return;
  const session = await context.newCDPSession(page);
  let target;
  try { target = (await session.send('Target.getTargetInfo')).targetInfo; } finally { await session.detach(); }
  const options = { behavior: 'allow', downloadPath, eventsEnabled: true };
  if (typeof target.browserContextId === 'string') options.browserContextId = target.browserContextId;
  const controller = await browser.newBrowserCDPSession();
  await controller.send('Browser.setDownloadBehavior', options); controllers.set(context, controller);
}
export async function operate(request, browser, privateDir = PRIVATE, allowedUrl = publicUrl, downloadPath = '/tmp/holo-downloads') {
  const context = browser.contexts().at(-1);
  const page = context.pages().filter(page => !page.isClosed()).at(-1) ?? await context.newPage();
  page.setDefaultTimeout(5000); await page.setViewportSize({ width: 1280, height: 800 });
  await configureDownloads(browser, context, page, downloadPath);
  await context.unroute('**/*');
  await context.route('**/*', async route => {
    try { if (await allowedUrl(route.request().url())) await route.continue(); else await route.abort(); }
    catch { /* Do not log URLs or values from credential-bearing pages. */ }
  });
  let secrets = [];
  try { secrets = JSON.parse(await readFile(privateDir + '/privacy.json', 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new PrivacyBlocked(); }
  let targetLabel = null;
  const op = request.operation;
  if (op === 'navigate') {
    if (!await allowedUrl(request.url)) throw new Error('Public HTTPS websites only.');
    await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } else if (op === 'verification_code') {
    if (!await allowedUrl(page.url()) || new URL(page.url()).origin !== request.origin) throw new Error('Website does not match the approved origin.');
    if (typeof request.code !== 'string' || !/^[A-Za-z0-9 -]{4,32}$/.test(request.code)) throw new Error('Invalid verification code.');
    const field = page.locator('input[autocomplete="one-time-code"]:visible, input[name="otp" i]:visible, input[name="code" i]:visible, input[name="verification_code" i]:visible');
    if (await field.count() !== 1) throw new Error('Verification fields are ambiguous.');
    if (!secrets.includes(request.code)) secrets.push(request.code);
    await writeFile(privateDir + '/privacy.json', JSON.stringify(secrets), { mode: 0o600 });
    if (new URL(page.url()).origin !== request.origin) throw new Error('Website changed before verification.');
    await field.fill(request.code);
  } else if (op === 'login') {
    const matchesOrigin = () => new URL(page.url()).origin === request.origin;
    if (!await allowedUrl(page.url()) || !matchesOrigin()) throw new Error('Website does not match the approved origin.');
    const password = page.locator('input[type=password]:visible');
    let username = page.locator('input[type=email]:visible, input[autocomplete=username]:visible');
    if (await username.count() === 0) username = page.locator('input[type=text]:visible');
    if (await password.count() !== 1 || await username.count() !== 1) throw new Error('Ambiguous login fields.');
    for (const value of [request.username, request.password]) if (!secrets.includes(value)) secrets.push(value);
    await writeFile(privateDir + '/privacy.json', JSON.stringify(secrets), { mode: 0o600 });
    if (!matchesOrigin()) throw new Error('Website changed before login.');
    await username.fill(request.username);
    if (!matchesOrigin()) throw new Error('Website changed during login.');
    await password.fill(request.password);
  } else if (op === 'click') {
    targetLabel = await page.evaluate(point => {
      const node = document.elementFromPoint(point.x, point.y)?.closest('button,a,input[type=submit],input[type=button]');
      return node ? (node.innerText || node.getAttribute('aria-label') || node.value || '').trim().slice(0, 120) : null;
    }, { x: request.x, y: request.y });
    if (typeof targetLabel === 'string') for (const value of secrets) targetLabel = targetLabel.replace(secretMatcher(value), '[private]');
    await page.mouse.click(request.x, request.y);
  } else if (op === 'type') { await guardPrivateInput(page); await page.keyboard.insertText(request.text); }
  else if (op === 'replace_text') {
    await page.mouse.click(request.x, request.y); await guardPrivateInput(page); await page.keyboard.press('Control+a'); await page.keyboard.insertText(request.text);
  } else if (op === 'key') {
    const names = { ctrl: 'Control', shift: 'Shift', enter: 'Enter', tab: 'Tab', escape: 'Escape', backspace: 'Backspace', delete: 'Delete', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', space: 'Space' };
    await page.keyboard.press(request.key.split('+').map(key => names[key] ?? key).join('+'));
  } else if (op === 'scroll') { await page.mouse.move(request.x, request.y); await page.mouse.wheel(0, request.direction === 'up' ? -450 : 450); }
  else if (op !== 'screen') throw new Error('Unknown browser operation.');
  // Public search boxes are model observations. Private fields stay masked,
  // and every editable field is masked after any private value is released.
  const privateFields = 'input[type=password], input[type=email], input[autocomplete=username], input[autocomplete="current-password"], input[autocomplete="new-password"], input[autocomplete="one-time-code"], input[name="otp" i], input[name="code" i], input[name="verification_code" i], form:has(input[type=password]) input:not([type=button]):not([type=submit])';
  const masks = [page.locator(secrets.length ? 'input:not([type=button]):not([type=submit]), textarea, [contenteditable=true]' : privateFields)];
  if (secrets.length) {
    const session = await context.newCDPSession(page);
    try { if (containsClosedShadow(await session.send('DOM.getDocument', { depth: -1, pierce: true }))) throw new PrivacyBlocked(); }
    finally { await session.detach(); }
    masks.push(page.locator('canvas, img, video, iframe, svg, object, embed'));
    // Locator matching must be stateless. A global RegExp advances lastIndex
    // between DOM nodes and can skip every second reflected credential.
    for (const value of secrets) masks.push(page.getByText(new RegExp(secretMatcher(value).source, 'i')));
  }
  let png;
  try { png = await page.screenshot({ mask: masks, maskColor: '#292929', animations: 'disabled', caret: 'hide', timeout: 10000 }); }
  catch { throw new CaptureFailed(); }
  const origin = await allowedUrl(page.url()) ? new URL(page.url()).origin : null;
  await writeFile(privateDir + '/screen.png', png, { mode: 0o600 });
  return { ok: true, origin, target_label: targetLabel };
}
const failure = error => ({ ok: false, error_code: error instanceof PrivacyBlocked ? 'privacy-blocked' : error instanceof PrivateLoginRequired ? 'private-login-required' : error instanceof CaptureFailed ? 'capture-failed' : 'operation-failed' });
async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function remove(path) { await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
async function serve() {
  const { chromium } = await import('playwright-core');
  let browser;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 1000 }); break; }
    catch { await sleep(500); }
  }
  if (!browser) return;
  await prepareContext(browser);
  for (;;) {
    await sleep(100);
    if (!await exists(PRIVATE + '/request.ready')) continue;
    await remove(PRIVATE + '/request.ready');
    let request = {}, result;
    try {
      request = JSON.parse(await readFile(PRIVATE + '/request.json', 'utf8'));
      await remove(PRIVATE + '/request.json'); result = await operate(request, browser);
    } catch (error) { result = failure(error); }
    result.request_id = request.request_id;
    await writeFile(PRIVATE + '/result.tmp', JSON.stringify(result), { mode: 0o600 });
    await rename(PRIVATE + '/result.tmp', PRIVATE + '/result.json');
  }
}
async function client() {
  const expected = JSON.parse(await readFile(PRIVATE + '/request.json', 'utf8')).request_id;
  await remove(PRIVATE + '/result.json');
  await writeFile(PRIVATE + '/request.ready', '', { mode: 0o600 });
  const deadline = Date.now() + 40000;
  try {
    while (Date.now() < deadline) {
      if (await exists(PRIVATE + '/result.json')) {
        const result = JSON.parse(await readFile(PRIVATE + '/result.json', 'utf8')); await remove(PRIVATE + '/result.json');
        if (result.request_id === expected) return result;
      }
      await sleep(50);
    }
    return failure();
  } finally { await remove(PRIVATE + '/request.json'); await remove(PRIVATE + '/request.ready'); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--serve')) await serve().catch(() => {});
  else console.log(JSON.stringify(await client().catch(() => failure())));
}
