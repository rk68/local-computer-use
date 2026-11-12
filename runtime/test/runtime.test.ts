import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { Desk, type DeskOptions } from '../src/desk.ts';
import { Runtime } from '../src/runtime.ts';
import { createApp } from '../src/server.ts';
import { modelAction, validateAction } from '../src/actions.ts';
import { websiteOrigin, explicitLogin } from '../src/credentials.ts';
import { BrowserSession } from '../src/browser.ts';
import { DesktopTask } from '../src/task.ts';
import type { Guest, GuestFactory } from '../src/guest.ts';
import type { Browser } from '../src/browser.ts';
import type { ModelRequest } from '../src/model.ts';

import { PNG, FakeGuest, tool } from './fixtures.ts';
class FakeFactory implements GuestFactory {
  guests: FakeGuest[] = []; recovered: string[] = [];
  async create(name: string, _network: boolean) { const guest = new FakeGuest('local:' + name); this.guests.push(guest); return guest; }
  async recover(name: string) { if (!/^holo-poc-[0-9a-f]{8}$/.test(name)) throw new Error('Invalid ownership record.'); this.recovered.push(name); }
}
function sequence(...responses: unknown[]): ModelRequest { return async () => { if (!responses.length) throw new Error('Unexpected inference'); return responses.shift(); }; }
async function fixture(work: (options: DeskOptions, directory: string, factory: FakeFactory) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'halo-runtime-'));
  const factory = new FakeFactory();
  try { await work({ owned: join(directory, 'owned.json'), screenshots: join(directory, 'screenshots'), factory, wait: async () => {} }, directory, factory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('normalized coordinates map to pixels and malformed tools cannot escape the contract', () => {
  assert.deepEqual(modelAction({ action: 'click', x: 500, y: 1000, reason: 'target' }, 1280, 800), { action: 'click', x: 640, y: 799, reason: 'target' });
  for (const action of [{ action: 'shell', command: 'touch /tmp/host', reason: 'bad' }, { action: 'type', text: 'a\nb', reason: 'bad' }, { action: 'key', key: 'ctrl+c', reason: 'bad' }, { action: 'click', x: true, y: 20, reason: 'bad' }, { action: 'click', x: 20, y: 20, reason: 'bad', extra: 1 }]) assert.throws(() => validateAction(action, 1280, 800));
  assert.throws(() => modelAction({ action: 'click', x: 1001, y: 100, reason: 'bad' }, 1280, 800));
});
test('thread context, ownership, approval IDs, and stop remain isolated', () => fixture(async (options, _directory, factory) => {
  const runtime = new Runtime(options); const a = 'a'.repeat(32), b = 'b'.repeat(32);
  await runtime.dispatch('/api/thread-context', { instructions: 'A', messages: [{ role: 'user', text: 'Private A' }] }, a);
  await runtime.dispatch('/api/thread-context', { instructions: 'B', messages: [{ role: 'assistant', text: 'Private B' }] }, b);
  const first = runtime.resolve(a), second = runtime.resolve(b);
  await first.start(); await second.start();
  assert.notEqual(first.owned, second.owned); assert.notEqual(first.sb!.id, second.sb!.id);
  assert.equal(first.messages[0].text, 'Private A'); assert.equal(second.messages[0].text, 'Private B');
  second.pending = { id: 'only-b', action: { action: 'click', x: 1, y: 1, reason: 'target' }, created: Date.now() / 1000, epoch: second.epoch };
  await assert.rejects(first.approve('only-b'), /missing/);
  await first.stop(); assert.ok(second.sb); assert.equal(second.pending.id, 'only-b'); assert.ok(existsSync(second.owned));
  assert.deepEqual(factory.guests[0].calls, [['destroy']]); await runtime.close();
}));
test('invalid thread paths and contexts fail before modifying state', () => fixture(async options => {
  const runtime = new Runtime(options);
  for (const id of ['../../secrets', '', '/tmp/a', 'abc']) assert.throws(() => runtime.resolve(id));
  await assert.rejects(runtime.dispatch('/api/thread-context', { messages: [{ role: 'tool', text: 'bad' }] }, 'a'.repeat(32)));
  assert.deepEqual(runtime.resolve('a'.repeat(32)).messages, []);
}));
test('restart reconciliation replaces stale sandbox flags with actual ownership state', () => fixture(async (options, directory) => {
  const a = 'a'.repeat(32), b = 'b'.repeat(32);
  const markers = join(directory, 'threads'); await mkdir(markers);
  await writeFile(join(markers, b + '.json'), JSON.stringify({ name: 'holo-poc-deadbeef' }));
  const runtime = new Runtime(options); const previous = globalThis.fetch; const updates: any[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init!.body));
    if (body.path === 'workspace:list') return Response.json({ status: 'success', value: { threads: [{ _id: a }, { _id: b }] } });
    updates.push(body.args); return Response.json({ status: 'success', value: null });
  };
  try {
    await runtime.reconcile('fixture-token');
    assert.equal(updates.find(u => u.threadId === a).sandbox, false); assert.equal(updates.find(u => u.threadId === a).phase, 'idle');
    assert.equal(updates.find(u => u.threadId === b).phase, 'cleanup required'); assert.ok(existsSync(join(markers, b + '.json')));
  } finally { globalThis.fetch = previous; await runtime.close(); }
}));
test('owned guests recover by exact recorded name and failed deletion preserves ownership', () => fixture(async (options, _directory, factory) => {
  const desk = new Desk(options); await desk.start(); const guest = factory.guests[0];
  guest.failDestroy = true; await desk.stop(); assert.equal(desk.phase, 'cleanup required'); assert.ok(existsSync(desk.owned)); assert.ok(desk.sb);
  guest.failDestroy = false; await desk.stop(); assert.equal(desk.phase, 'idle'); assert.equal(existsSync(desk.owned), false);
  await writeFile(desk.owned, JSON.stringify({ name: 'holo-poc-deadbeef' }));
  const recovered = new Desk(options); assert.equal(recovered.phase, 'cleanup required'); await recovered.stop(); assert.deepEqual(factory.recovered, ['holo-poc-deadbeef']);
  await writeFile(desk.owned, JSON.stringify({ name: '../other-guest' })); await recovered.stop(); assert.equal(recovered.phase, 'cleanup required'); assert.ok(existsSync(desk.owned));
}));
test('approvals expire, are consumed once, and count uncertain action attempts', () => fixture(async options => {
  const desk = new Desk(options); await desk.start();
  const pending = () => ({ id: 'approval', epoch: desk.epoch, created: Date.now() / 1000, action: { action: 'click', x: 20, y: 20, reason: 'target' } });
  desk.pending = { ...pending(), created: Date.now() / 1000 - 121 }; await assert.rejects(desk.approve('approval'), /expired/); assert.equal(desk.pending, null);
  desk.pending = pending(); await desk.approve('approval'); await assert.rejects(desk.approve('approval'), /missing/); assert.equal(desk.actions, 1);
  desk.sb!.click = async () => { throw new Error('RPC uncertain'); }; desk.pending = pending(); await assert.rejects(desk.approve('approval'), /uncertain/); assert.equal(desk.actions, 2); assert.equal(desk.pending, null);
  desk.actions = 20; desk.pending = pending(); await assert.rejects(desk.approve('approval'), /limit/); await desk.stop();
}));
test('Stop fences a delayed model reply and interrupts a multi-RPC replacement', () => fixture(async options => {
  let resolve!: (value: unknown) => void;
  const desk = new Desk({ ...options, request: () => new Promise(done => { resolve = done; }) }); await desk.start();
  const work = desk.chat('Click the button', true); while (!resolve) await new Promise(done => setImmediate(done));
  await desk.stop(); resolve(tool('desktop_click', { x: 100, y: 100, reason: 'target' })); await work;
  assert.equal(desk.pending, null); assert.equal(desk.sb, null);
  const replacement = new Desk(options); await replacement.start();
  replacement.sb!.click = async () => { void replacement.stop(); };
  replacement.pending = { id: 'replace', epoch: replacement.epoch, created: Date.now() / 1000, action: { action: 'replace_text', x: 1, y: 1, text: 'Alex', reason: 'replace field' } };
  await replacement.approve('replace'); await replacement.stop();
  assert.equal(replacement.actions, 1);
}));
test('desktop loop requires approved action and independent positive verification', () => fixture(async options => {
  const desk = new Desk({ ...options, request: sequence(tool('desktop_click', { x: 500, y: 500, reason: 'target' }), tool('desktop_reply', { text: 'Done' }), { choices: [{ message: { content: JSON.stringify({ verified: true, evidence: 'The requested state is visible.' }) } }] }) });
  await desk.start(); await desk.chat('Click the button', true); assert.ok(desk.pending); assert.equal(desk.actions, 0);
  const approval = desk.pending.id; await desk.approve(approval);
  assert.equal(desk.actions, 1); assert.match(desk.messages.at(-1)!.text, /^Verified/); assert.equal(desk.desktopTask, null); await desk.stop();
}));
test('negative completion assessment prevents a success report', () => fixture(async options => {
  const desk = new Desk({ ...options, request: sequence({ choices: [{ message: { content: '{"verified":false,"evidence":"The requested file is missing."}' } }] }) });
  await desk.start(); desk.desktopTask = new DesktopTask('Download report.pdf', 0); desk.desktopTask.steps = 1;
  await assert.rejects(desk.finishDesktopReply('Download report.pdf', 'Done', true, desk.epoch), /does not verify/); assert.equal(desk.messages.some(m => m.text.startsWith('Verified')), false); await desk.stop();
}));
test('failed completion can resume missing work, with a bounded assessment budget', () => fixture(async options => {
  const desk = new Desk({ ...options, request: sequence(
    tool('desktop_reply', { text: 'Done' }), { choices: [{ message: { content: '{"verified":false,"evidence":"The Save button was not clicked."}' } }] },
    tool('desktop_click', { x: 500, y: 500, reason: 'Save the completed form' }), tool('desktop_reply', { text: 'Done' }),
    { choices: [{ message: { content: '{"verified":true,"evidence":"The saved result is visible."}' } }] },
  ) });
  await desk.start(); desk.desktopTask = new DesktopTask('Click Save', desk.epoch); desk.desktopTask.steps = 1;
  await desk.advanceDesktopTask(); assert.ok(desk.pending); assert.equal(desk.desktopTask.verificationRetries, 1);
  await desk.approve(desk.pending.id); assert.equal(desk.desktopTask, null); assert.match(desk.messages.at(-1)!.text, /^Verified/); await desk.stop();
}));
test('repeated actions and alternating cycles pause the task', () => {
  const task = new DesktopTask('goal', 0); task.record('a', {}, 'same'); task.record('a', {}, 'same'); assert.throws(() => task.record('a', {}, 'same'), /repeated/);
  const cycle = new DesktopTask('goal', 0); for (const a of ['a', 'b', 'a', 'b', 'a']) cycle.record(a, {}, a); assert.throws(() => cycle.record('b', {}, 'b'), /cycle/);
});
test('chat and website restrictions do not create desktop actions', () => fixture(async options => {
  const desk = new Desk({ ...options, request: async () => { throw new Error('Unexpected inference'); } });
  assert.match((await desk.chat('Open https://example.com', false))!, /internet access turned off/);
  assert.match((await desk.chat('Click the button', false))!, /start it and enable/); assert.equal(desk.pending, null);
}));
test('private login is explicit, origin scoped, and never enters transcript', () => fixture(async options => {
  const received: unknown[] = []; let saved: unknown;
  const browser: Browser = { origin: 'https://example.com', lastTarget: null, prepare: async () => {}, call: async (op, args) => { received.push([op, args]); return PNG; } };
  const desk = new Desk({ ...options, browser: () => browser, vault: { save: async (_origin, value) => { saved = value; }, read: async () => ({ username: 'demo', password: 'secret' }), delete: async () => {} } });
  await desk.start(true);
  assert.throws(() => desk.requestLogin('Open the login page', { reason: 'login' }), /does not request/);
  desk.requestLogin('Sign me in to example.com', { reason: 'login' });
  const request = desk.credentialRequest!;
  await desk.login({ id: request.id, username: 'demo', password: 'secret', remember: true });
  assert.deepEqual(saved, { username: 'demo', password: 'secret' }); assert.equal(desk.credentialRequest, null); assert.equal(desk.actions, 1);
  assert.ok(JSON.stringify(received).includes('secret')); assert.equal(JSON.stringify(desk.snapshot()).includes('secret'), false);
  desk.requestLogin('Sign me in', { reason: 'login' }); browser.origin = 'https://other.example';
  await assert.rejects(desk.login({ id: desk.credentialRequest!.id, username: 'demo', password: 'secret' }), /website changed/i); await desk.stop();
}));
test('browser errors redact secrets and remove the transient request', async () => {
  const guest = new FakeGuest('fixture'); guest.shell = async () => { throw new Error('secret-value'); };
  const browser = new BrowserSession(guest);
  await assert.rejects(browser.call('login', { username: 'demo', password: 'secret-value' }), error => error instanceof Error && !error.message.includes('secret-value'));
  assert.equal(guest.files.has('/dev/shm/holo-private/request.json'), false);
});
test('one-time codes stay outside transcript and never enter Keychain', () => fixture(async options => {
  const received: unknown[] = [];
  const browser: Browser = { origin: 'https://example.com', lastTarget: null, prepare: async () => {}, call: async (op, args) => { received.push([op, args]); return PNG; } };
  const desk = new Desk({ ...options, browser: () => browser, vault: { save: async () => { throw new Error('Code must never be saved'); }, read: async () => { throw new Error('Code must never be loaded'); }, delete: async () => {} } });
  await desk.start(true); desk.requestLogin('Sign me in', { reason: 'A verification code is required.' }, 'code');
  await desk.login({ id: desk.credentialRequest!.id, code: '483921', remember: true });
  assert.ok(JSON.stringify(received).includes('483921')); assert.equal(JSON.stringify(desk.snapshot()).includes('483921'), false); await desk.stop();
}));
test('website credential origin rejects credentials and nonstandard ports', () => {
  assert.equal(websiteOrigin('https://EXAMPLE.com/path'), 'https://example.com');
  for (const value of ['http://example.com', 'https://user:pass@example.com', 'https://example.com:444']) assert.throws(() => websiteOrigin(value));
  assert.ok(explicitLogin('Please sign me in')); assert.equal(explicitLogin('Open https://example.com/login'), false);
});
test('HTTP contract blocks rebinding, cross-site requests, unauthenticated mutations, and invalid content', () => fixture(async options => {
  const runtime = new Runtime(options); const server = createApp(runtime, 'fixture-token', 'http://127.0.0.1:18765');
  server.listen(18765, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:18765';
  try {
    assert.equal((await fetch(base + '/api/session')).status, 200);
    assert.equal((await fetch(base + '/api/session', { headers: { Origin: 'https://evil.example' } })).status, 403);
    const reboundStatus = await new Promise<number | undefined>((done, fail) => {
      const req = httpRequest(base + '/api/session', { headers: { Host: 'evil.example' } }, res => { res.resume(); done(res.statusCode); }); req.on('error', fail); req.end();
    });
    assert.equal(reboundStatus, 403);
    assert.equal((await fetch(base + '/api/state')).status, 403);
    assert.equal((await fetch(base + '/api/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await fetch(base + '/api/start', { method: 'POST', headers: { 'X-Local-Token': 'fixture-token' }, body: '{}' })).status, 400);
    const state = await fetch(base + '/api/state', { headers: { 'X-Local-Token': 'fixture-token', 'X-Halo-Thread': 'a'.repeat(32) } });
    assert.equal(state.status, 200); assert.equal((await state.json()).sandbox, false); assert.ok(state.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
    const invalid = await fetch(base + '/api/thread-context', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Token': 'fixture-token' }, body: JSON.stringify({ instructions: ['secret-value'] }) });
    assert.equal(invalid.status, 400); assert.equal((await invalid.text()).includes('secret-value'), false);
  } finally { server.close(); server.closeAllConnections(); await runtime.close(); }
}));
test('legacy transcript is read without creating or modifying the recovery database', () => fixture(async (options, directory) => {
  const { DatabaseSync } = await import('node:sqlite');
  const path = join(directory, 'legacy.sqlite3'); const db = new DatabaseSync(path); db.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, role TEXT, text TEXT)'); db.prepare('INSERT INTO messages (role,text) VALUES (?,?)').run('user', 'Old history'); db.close();
  const original = await readFile(path); const previous = process.env.HOLO_CHAT_DB; process.env.HOLO_CHAT_DB = path;
  try { const runtime = new Runtime(options); assert.deepEqual(JSON.parse(JSON.stringify(await runtime.legacyHistory())), [{ role: 'user', text: 'Old history' }]); assert.deepEqual(await readFile(path), original); }
  finally { if (previous === undefined) delete process.env.HOLO_CHAT_DB; else process.env.HOLO_CHAT_DB = previous; }
}));

test('shared screenshots survive restart, stay thread scoped, and require HTTP authentication', () => fixture(async options => {
  const runtime = new Runtime(options), a = 'a'.repeat(32), b = 'b'.repeat(32);
  const first = runtime.resolve(a); await first.start();
  const attachment = await first.shareScreenshot('Fixture capture'); assert.ok(attachment);
  assert.deepEqual(await first.screenshots.read(attachment.id), PNG);
  await first.stop();
  const restarted = new Runtime(options);
  assert.deepEqual(await restarted.resolve(a).screenshots.read(attachment.id), PNG);
  await assert.rejects(restarted.resolve(b).screenshots.read(attachment.id), /unavailable/);
  await assert.rejects(first.screenshots.read('../owned'), /Invalid/);
  const server = createApp(restarted, 'fixture-token', 'http://127.0.0.1:18766');
  server.listen(18766, '127.0.0.1'); await once(server, 'listening');
  try {
    const url = 'http://127.0.0.1:18766/api/artifacts/' + attachment.id;
    assert.equal((await fetch(url)).status, 403);
    const headers = { 'X-Local-Token': 'fixture-token', 'X-Halo-Thread': a };
    const image = await fetch(url, { headers }); assert.equal(image.status, 200); assert.equal(image.headers.get('Content-Type'), 'image/png');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), PNG);
    assert.equal((await fetch(url, { headers: { ...headers, 'X-Halo-Thread': b } })).status, 400);
    first.pending = { id: 'pending', epoch: first.epoch, created: Date.now() / 1000, action: { action: 'click', x: 1, y: 1, reason: 'fixture' } };
    await assert.rejects(first.shareScreenshot(), /Resolve/);
  } finally { server.close(); server.closeAllConnections(); await runtime.close(); await restarted.close(); }
}));
test('model can share a screenshot, then independently verify the requested visual outcome', () => fixture(async options => {
  const desk = new Desk({ ...options, request: sequence(
    tool('desktop_share_screenshot', { caption: 'The selected orange cat' }), tool('desktop_reply', { text: 'Here is the result.' }),
    { choices: [{ message: { content: '{"verified":true,"evidence":"The selected result is visible and shared."}' } }] },
  ) });
  await desk.start(); await desk.chat('Share a screenshot of the current picture', true);
  assert.ok(desk.messages.find(message => message.attachment)); assert.equal(desk.desktopTask, null);
  assert.match(desk.messages.at(-1)!.text, /^Verified/); assert.equal(desk.actions, 0);
  await desk.stop();
}));
test('an image selection request cannot complete without a guest action or shared capture', () => fixture(async options => {
  const desk = new Desk({ ...options, request: sequence(tool('desktop_reply', { text: 'I picked an orange cat.' })) });
  await desk.start(); await desk.chat('Pick a picture of an orange cat', true);
  assert.match(desk.messages.at(-1)!.text, /did not propose an action/);
  assert.equal(desk.messages.some(message => message.attachment), false); await desk.stop();
}));
test('verified visual tasks automatically attach their final screenshot', () => fixture(async options => {
  const desk = new Desk({ ...options, request: sequence({ choices: [{ message: { content: '{"verified":true,"evidence":"The chosen orange cat preview is visible."}' } }] }) });
  await desk.start(); desk.desktopTask = new DesktopTask('Pick a picture of an orange cat', desk.epoch); desk.desktopTask.steps = 1;
  await desk.finishDesktopReply(desk.desktopTask.goal, 'Done', true, desk.epoch);
  assert.equal(desk.messages.filter(message => message.attachment).length, 1); assert.match(desk.messages.at(-1)!.text, /^Verified/);
  await desk.stop();
}));
