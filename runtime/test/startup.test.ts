import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recordWebBuild, webBuildNeeded } from '../src/startup-cache.ts';

async function fixture(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'halo-startup-'));
  try {
    await mkdir(join(root, 'web/src'), { recursive: true }); await mkdir(join(root, 'web/dist/assets'), { recursive: true });
    await writeFile(join(root, 'web/src/main.tsx'), 'source-a'); await writeFile(join(root, 'web/dist/index.html'), '<script src="/assets/app.js"></script>');
    await writeFile(join(root, 'web/dist/assets/app.js'), 'compiled-a'); await work(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
test('startup cache reuses only an unchanged web build, including same-timestamp source edits', () => fixture(async root => {
  assert.equal(await webBuildNeeded(root), true); await recordWebBuild(root); assert.equal(await webBuildNeeded(root), false);
  const source = join(root, 'web/src/main.tsx'), before = await stat(source);
  await writeFile(source, 'source-b'); await utimes(source, before.atime, before.mtime);
  assert.equal(await webBuildNeeded(root), true); await recordWebBuild(root); assert.equal(await webBuildNeeded(root), false);
  await writeFile(join(root, 'web/package-lock.json'), 'changed-dependency'); assert.equal(await webBuildNeeded(root), true);
}));
test('startup cache detects missing assets, corrupt output, and invalid manifests', () => fixture(async root => {
  await recordWebBuild(root); await rm(join(root, 'web/dist/assets/app.js')); assert.equal(await webBuildNeeded(root), true);
  await writeFile(join(root, 'web/dist/assets/app.js'), 'compiled-b'); await recordWebBuild(root);
  await writeFile(join(root, 'web/dist/index.html'), 'corrupt'); assert.equal(await webBuildNeeded(root), true);
  await writeFile(join(root, '.cache/halo/web-build.json'), '{invalid'); assert.equal(await webBuildNeeded(root), true);
}));
