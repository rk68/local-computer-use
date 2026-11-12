// Real online VM, public dummy login only. Never reads a real saved account.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { Desk } from '../src/desk.ts';
import { PrivacyViewBlocked } from '../src/browser.ts';
import { OWNED, ROOT } from '../src/config.ts';
const label = 'Halo QA ' + randomBytes(6).toString('hex');
const origin = 'https://the-internet.herokuapp.com';
const value = { username: 'tomsmith', password: 'SuperSecretPassword!' };
const desk = new Desk({ owned: join(dirname(OWNED), 'threads', randomBytes(16).toString('hex') + '.json') });
try {
  console.log('Live browser fixture: starting disposable online VM.');
  await desk.start(true);
  assert.ok(desk.browser);
  await desk.browser!.call('navigate', { url: origin + '/login' });
  desk.requestLogin('Sign me in to the public demo account', { reason: 'Public dummy login fixture.' });
  await desk.login({ id: desk.credentialRequest!.id, ...value, remember: true, account: label });
  assert.deepEqual(await desk.vault.read(origin, label), value);
  assert.equal(JSON.stringify(desk.snapshot()).includes(value.password), false);
  const directory = join(ROOT, 'artifacts/overnight'); await mkdir(directory, { recursive: true });
  await desk.capture(); await writeFile(join(directory, 'live-private-login.png'), Buffer.from(desk.screen!.split(',')[1], 'base64'));
  console.log('PASS: real online VM and JavaScript browser helper; public dummy login fills, named Keychain save/read, masked guest screenshot, no secrets in transcript.');
  // Clear and reuse the same named account through the normal private path.
  await desk.browser!.call('navigate', { url: origin + '/login' });
  desk.requestLogin('Sign me in to the public demo account', { reason: 'Public dummy saved-account reuse.' });
  await desk.login({ id: desk.credentialRequest!.id, use_saved: true, account: label });
  await desk.vault.delete(origin, label);
  await assert.rejects(desk.vault.read(origin, label));
  console.log('PASS: named account reuse and deletion inside the actual guest flow.');
  // Controlled adversarial fixture, injected only into this disposable guest.
  // Keep the approved public origin; never relax the production URL policy.
  const fixture = `import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts().at(-1).pages().at(-1);
if (process.argv.includes('--closed')) {
  await page.evaluate(() => document.querySelector('#shadow').attachShadow({mode:'closed'}).innerHTML='<p>Private shadow fixture</p>');
} else {
  await page.setContent('<style>body{background:#fff;color:#111;font:18px system-ui;padding:24px}input,#reflect,#timed,canvas{display:block;width:400px;height:45px;margin:10px;padding:8px;box-sizing:border-box}</style><p>Controlled guest privacy fixture</p><input id="user"><input id="pass" type="password"><div id="reflect"></div><div id="timed"></div><canvas id="media" width="400" height="45"></canvas><div id="shadow"></div>');
  await page.evaluate(({username,password})=>{
    document.querySelector('#user').value=username;document.querySelector('#pass').value=password;
    document.querySelector('#reflect').textContent=username.toUpperCase().split('').join('\\u200b');
    let turn=0;setInterval(()=>{document.querySelector('#timed').textContent=++turn%2?password:password.toUpperCase().split('').join(' ');},5);
    const ctx=document.querySelector('#media').getContext('2d');ctx.fillText(password,10,25);
  },${JSON.stringify(value)});
  const boxes={};for(const id of ['user','pass','reflect','timed','media'])boxes[id]=await page.locator('#'+id).boundingBox();
  console.log(JSON.stringify(boxes));
}
process.exit(0);`;
  await desk.sb!.writeText('/tmp/holo-browser-env/privacy-fixture.mjs', fixture);
  const result = await desk.sb!.shell('node /tmp/holo-browser-env/privacy-fixture.mjs', 20000);
  assert.equal(result.success, true, 'Guest privacy fixture setup failed.');
  const boxes = JSON.parse(result.stdout) as Record<string, { x: number; y: number; width: number; height: number }>;
  const { PNG } = createRequire(import.meta.url)('pngjs') as { PNG: { sync: { read(data: Buffer): { width: number; height: number; data: Buffer } } } };
  for (let sample = 0; sample < 5; sample++) {
    const screenshot = await desk.browser!.call('screen'); const png = PNG.sync.read(screenshot);
    for (const [name, box] of Object.entries(boxes)) {
      let count = 0, masked = 0;
      for (let y = Math.ceil(box.y) + 2; y < Math.floor(box.y + box.height) - 2; y++) for (let x = Math.ceil(box.x) + 2; x < Math.floor(box.x + box.width) - 2; x++) {
        const pixel = (y * png.width + x) * 4; count++; if (png.data[pixel] === 41 && png.data[pixel + 1] === 41 && png.data[pixel + 2] === 41) masked++;
      }
      assert.ok(count && masked / count > .98, 'Actual guest mask failed for ' + name);
    }
    if (sample === 0) await writeFile(join(directory, 'live-private-fixture.png'), screenshot);
  }
  assert.equal((await desk.sb!.shell('node /tmp/holo-browser-env/privacy-fixture.mjs --closed', 20000)).success, true);
  await assert.rejects(desk.browser!.call('screen'), PrivacyViewBlocked);
  console.log('PASS: actual guest pixel checks for inputs, reflected case/invisible spacing, 5ms alternating secret text across five captures, canvas, and closed-shadow rejection.');
} catch (error) {
  if (desk.sb) {
    const result = await desk.sb.shell(`node -e "require('node:dns').lookup('the-internet.herokuapp.com',{all:true},(e,a)=>console.log(JSON.stringify({dnsError:e?.code,addresses:a})));fetch('https://the-internet.herokuapp.com/login').then(r=>console.log('public-demo-status',r.status)).catch(e=>console.log('public-demo-error',e.cause?.code||e.name))"`, 20000).catch(() => null);
    if (result) console.log('Guest network diagnosis: ' + result.stdout.slice(0, 1000));
    const capture = await desk.browser?.call('screen').catch(() => null);
    if (capture) { const directory = join(ROOT, 'artifacts/overnight'); await mkdir(directory, { recursive: true }); await writeFile(join(directory, 'live-online-failure.png'), capture); }
  }
  throw error;
} finally {
  await desk.vault.delete(origin, label).catch(() => {});
  await desk.stop(); if (desk.error) throw new Error(desk.error);
}
