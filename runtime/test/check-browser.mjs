// Isolated local fixture. No user profile, real credentials, model, or VM.
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { operate, PrivateLoginRequired, PrivacyBlocked } from '../src/guest-browser.mjs';

const directory = await mkdtemp(join(tmpdir(), 'halo-private-render-'));
const downloads = join(directory, 'downloads'); await mkdir(downloads);
const username = 'fixture.person@example.test', password = 'FIXTURE-ONLY-4729';
const fixture = `<!doctype html><meta charset="utf-8"><style>body{font:18px system-ui;background:#fff;color:#000;padding:24px}input{display:block;width:400px;padding:12px;margin:12px 0}#echo,#changed{padding:16px;min-height:24px}canvas,svg,iframe{display:block;width:400px;height:60px;margin:12px 0}#public{padding:20px;background:#00bfa0}</style><p id="public">Public content remains visible</p><a id="download" href="/fixture-download.txt">Download test file</a><input type="email" id="username"><input type="password" id="password"><div id="echo"></div><div id="changed"></div><canvas id="canvas" width="400" height="60"></canvas><svg id="vector" viewBox="0 0 400 60"><path d="M0 0h400v60H0Z" fill="red"/></svg><iframe srcdoc="<p>${password}</p>"></iframe><div id="shadow"></div><script>username.addEventListener('input',()=>echo.textContent=username.value);password.addEventListener('input',()=>{const c=canvas.getContext('2d');c.fillStyle='red';c.fillRect(0,0,400,60);c.fillStyle='white';c.fillText(password.value,10,30)});</script>`;
const server = createServer((req, res) => {
  if (req.url === '/fixture-download.txt') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename=fixture-download.txt' }); res.end('fixture-only download'); }
  else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fixture); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage(); await page.goto(base);
  const allowed = value => new URL(value).origin === base;
  const call = request => operate(request, browser, directory, allowed, downloads);
  // Search content must remain visible before private data enters the session.
  await page.evaluate(() => { const search = document.createElement('input'); search.id = 'search'; search.type = 'search'; search.value = 'orange cat'; document.body.prepend(search); });
  await call({ operation: 'screen' });
  const searchBox = await page.locator('#search').boundingBox();
  const publicPng = PNG.sync.read(await readFile(join(directory, 'screen.png')));
  const center = ((Math.floor(searchBox.y + searchBox.height / 2) * publicPng.width) + Math.floor(searchBox.x + searchBox.width / 2)) * 4;
  assert.notDeepEqual([...publicPng.data.subarray(center, center + 3)], [41, 41, 41], 'Public search field must remain visible');
  await masked('#username'); await masked('#password');
  await call({ operation: 'login', origin: base, username, password });
  await assert.rejects(call({ operation: 'type', text: 'MUST-NOT-BE-TYPED' }), PrivateLoginRequired);
  assert.equal(await page.locator('#password').inputValue(), password);
  async function masked(selector) {
    const bounds = await page.locator(selector).boundingBox(); assert.ok(bounds);
    const png = PNG.sync.read(await readFile(join(directory, 'screen.png')));
    let count = 0, covered = 0;
    for (let y = Math.ceil(bounds.y) + 2; y < Math.min(png.height, Math.floor(bounds.y + bounds.height) - 2); y++) for (let x = Math.ceil(bounds.x) + 2; x < Math.min(png.width, Math.floor(bounds.x + bounds.width) - 2); x++) {
      const i = (y * png.width + x) * 4; count++; if (png.data[i] === 41 && png.data[i + 1] === 41 && png.data[i + 2] === 41) covered++;
    }
    assert.ok(count > 0 && covered / count > .98, selector + ' is not fully masked');
  }
  for (const selector of ['#search', '#username', '#password', '#echo', '#canvas', '#vector', 'iframe']) await masked(selector);
  await page.evaluate(value => { document.querySelector('#changed').textContent = value.toUpperCase().split('').join('\u200b'); }, username);
  await call({ operation: 'screen' }); await masked('#changed');
  await page.evaluate(() => { document.querySelector('#shadow').attachShadow({ mode: 'closed' }).innerHTML = '<p>Private rendered content</p>'; });
  await assert.rejects(call({ operation: 'screen' }), PrivacyBlocked);
  await page.goto(base); await assert.rejects(call({ operation: 'login', origin: 'https://other.example', username, password }), /approved origin/);
  const link = await page.locator('#download').boundingBox();
  await call({ operation: 'click', x: Math.round(link.x + link.width / 2), y: Math.round(link.y + link.height / 2) });
  for (let attempt = 0; attempt < 100 && !(await readdir(downloads)).includes('fixture-download.txt'); attempt++) await new Promise(done => setTimeout(done, 100));
  assert.equal(await readFile(join(downloads, 'fixture-download.txt'), 'utf8'), 'fixture-only download');
  await page.goto(base);
  await page.evaluate(() => { document.body.innerHTML = '<input id="code" autocomplete="one-time-code"><div id="code-echo"></div>'; document.querySelector('#code').addEventListener('input', event => { document.querySelector('#code-echo').textContent = event.target.value; }); });
  await call({ operation: 'verification_code', origin: base, code: '483921' });
  assert.equal(await page.locator('#code').inputValue(), '483921'); await masked('#code'); await masked('#code-echo');
  await assert.rejects(call({ operation: 'type', text: 'MUST-NOT-BE-TYPED' }), PrivateLoginRequired);
  console.log('PASS: rendered masks cover inputs, reflected secrets, case/invisible spacing, media, and private one-time codes; closed shadow blocks capture; wrong-origin login refuses secrets; download completes.');
} finally { await browser.close(); server.close(); server.closeAllConnections(); await rm(directory, { recursive: true, force: true }); }
