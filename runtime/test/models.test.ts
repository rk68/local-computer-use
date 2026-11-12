import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ModelManager, modelArgs, MODEL_CATALOG, type ModelSpec } from '../src/models.ts';

test('model launcher uses fixed local files, loopback, offline mode, and one model slot', () => {
  const args = modelArgs(MODEL_CATALOG[0], '/fixture');
  assert.equal(args[args.indexOf('--host') + 1], '127.0.0.1'); assert.equal(args[args.indexOf('--parallel') + 1], '1');
  assert.equal(args[args.indexOf('--model') + 1], '/fixture/models/holo4/q4_k_m.gguf'); assert.ok(args.includes('--offline'));
});
test('model manager refuses unknown models, active work, and missing weights', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'halo-model-'));
  try {
    const manager = new ModelManager(async () => false, directory);
    await assert.rejects(manager.start('../../host/file'), /supported/);
    await assert.rejects(manager.start(MODEL_CATALOG[0].id), /Download both/);
    const busy = new ModelManager(async () => true, directory);
    await assert.rejects(busy.start(MODEL_CATALOG[0].id), /finish/); await assert.rejects(busy.stop(), /finish/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('model downloads verify hashes before installing; corrupt weights remain uninstalled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'halo-download-'));
  const bytes = Buffer.from('fixture-weights'); const sha256 = createHash('sha256').update(bytes).digest('hex');
  const spec: ModelSpec = { id: 'fixture', name: 'Fixture', detail: 'Test only', license: 'Fixture', repo: 'Hcompany/fixture', revision: 'pinned-fixture', directory: 'fixture', files: [{ name: 'q4_k_m.gguf', size: bytes.length, sha256 }] };
  const originalFetch = globalThis.fetch; const urls: string[] = [];
  try {
    globalThis.fetch = async input => { urls.push(String(input)); return new Response(bytes); };
    const manager = new ModelManager(async () => false, directory, [spec]);
    await manager.download('fixture');
    for (let i = 0; i < 100 && manager.phase === 'downloading'; i++) await new Promise(done => setTimeout(done, 5));
    assert.equal(manager.phase, 'off'); assert.ok(await manager.installed(spec));
    assert.deepEqual(await readFile(join(directory, 'models/fixture/q4_k_m.gguf')), bytes);
    assert.ok(urls.every(url => url.includes('/resolve/pinned-fixture/')));
    const bad = { ...spec, id: 'bad', directory: 'bad', files: [{ ...spec.files[0], sha256: '0'.repeat(64) }] };
    const corrupt = new ModelManager(async () => false, directory, [bad]); await corrupt.download('bad');
    for (let i = 0; i < 100 && corrupt.phase === 'downloading'; i++) await new Promise(done => setTimeout(done, 5));
    assert.equal(corrupt.phase, 'failed'); assert.equal(await corrupt.installed(bad), false); assert.equal(existsSync(join(directory, 'models/bad/q4_k_m.gguf')), false);
  } finally { globalThis.fetch = originalFetch; await rm(directory, { recursive: true, force: true }); }
});
test('small Holo models pair their own weights and vision projector with pinned files', () => {
  const seen = new Set<string>();
  for (const spec of MODEL_CATALOG) {
    assert.ok(!seen.has(spec.id)); seen.add(spec.id);
    assert.match(spec.revision, /^[a-f0-9]{40}$/);
    for (const file of spec.files) { assert.match(file.sha256, /^[a-f0-9]{64}$/); assert.ok(file.size > 0); assert.ok(!file.name.includes('/')); }
  }
  for (const variant of ['08b', '4b', '9b']) {
    const spec = MODEL_CATALOG.find(spec => spec.id === 'holo31-' + variant)!; assert.ok(spec);
    assert.equal(spec.license, 'Apache 2.0'); assert.match(spec.provenance!, /Community/);
    const weights = spec.files.find(file => file.role === 'weights')!, projector = spec.files.find(file => file.role === 'projector')!;
    assert.ok(weights && projector); assert.ok(weights.name.includes('Q4_K_M')); assert.ok(projector.name.includes('mmproj-f16'));
    const args = modelArgs(spec, '/fixture');
    assert.equal(args[args.indexOf('--model') + 1], join('/fixture/models', spec.directory, weights.name));
    assert.equal(args[args.indexOf('--mmproj') + 1], join('/fixture/models', spec.directory, projector.name));
    assert.equal(args[args.indexOf('--host') + 1], '127.0.0.1'); assert.ok(args.includes('--offline'));
  }
});
