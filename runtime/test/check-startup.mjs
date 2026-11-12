// Cold-process Mac startup: services must be stopped before each sample.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url));
const label = process.argv[2] ?? 'current', count = Number(process.argv[3] ?? '2');
assert.match(label, /^[a-z0-9-]+$/); assert.ok(count > 0 && count <= 5);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function listening(port) {
  return new Promise(resolve => { const socket = connect({ host: '127.0.0.1', port }); socket.setTimeout(300); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); socket.once('timeout', () => { socket.destroy(); resolve(false); }); });
}
const samples = [];
for (let index = 0; index < count; index++) {
  assert.equal(await listening(8765), false, 'Stop Halo before benchmarking.');
  assert.equal(await listening(3210), false, 'Stop local Convex before benchmarking.');
  const child = spawn(join(root, 'artifacts/Halo.app/Contents/MacOS/Halo'), ['--smoke-test'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const [code] = await once(child, 'exit'); assert.equal(code, 0, output);
  assert.match(output, /PASS: native Mac window loaded/);
  const native = JSON.parse(await readFile(join(root, 'logs/startup-native.json'), 'utf8'));
  const runtime = JSON.parse(await readFile(join(root, 'logs/startup-runtime.json'), 'utf8'));
  assert.ok(native.interactiveMs > 0); samples.push({ native, runtime });
  console.log(JSON.stringify({ sample: index + 1, interactiveMs: Math.round(native.interactiveMs), runtime }));
  for (let attempt = 0; await listening(3210) || await listening(8765); attempt++) { assert.ok(attempt < 100, 'Owned services did not stop.'); await wait(100); }
}
await mkdir(join(root, 'artifacts/startup'), { recursive: true });
const result = { label, samples, averageInteractiveMs: samples.reduce((total, sample) => total + sample.native.interactiveMs, 0) / samples.length };
await writeFile(join(root, 'artifacts/startup', label + '.json'), JSON.stringify(result, null, 2));
console.log(label + ' mean interactive: ' + Math.round(result.averageInteractiveMs) + ' ms');
