import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
async function fixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'halo-installer-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin');
  await mkdir(bin);
  const env = { ...process.env, HOME: directory, HALO_BIN_DIR: join(directory, 'commands'), PATH: bin + ':/usr/bin:/bin' };
  async function command(name, body) {
    await writeFile(join(bin, name), '#!/bin/bash\n' + body + '\n', { mode: 0o755 });
  }
  const run = (script, args = []) => spawnSync('/bin/bash', [script, ...args], { env, encoding: 'utf8' });
  return { directory, env, command, run };
}

test('help works without installing dependencies and unknown commands fail', async t => {
  const f = await fixture(t);
  const help = f.run(join(root, 'halo'), ['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /halo install/);
  const unknown = f.run(join(root, 'halo'), ['invalid']);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown command/);
});

test('the installer refuses an unsupported platform before running tools', async t => {
  const f = await fixture(t);
  await f.command('uname', 'echo Linux');
  for (const file of ['halo', 'install.sh']) {
    const result = f.run(join(root, file), file === 'halo' ? ['install'] : []);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Apple silicon Mac/);
  }
});

test('install preserves an existing command instead of replacing it', async t => {
  const f = await fixture(t);
  await f.command('uname', 'if [[ "$1" == -s ]]; then echo Darwin; else echo arm64; fi');
  await f.command('xcode-select', 'exit 0');
  await mkdir(f.env.HALO_BIN_DIR);
  const existing = join(f.env.HALO_BIN_DIR, 'halo');
  await writeFile(existing, 'another application');
  const result = f.run(join(root, 'halo'), ['install']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already belongs to another installation/);
  assert.equal(await readFile(existing, 'utf8'), 'another application');
});

test('the bootstrap installer preserves a directory that is not a Halo checkout', async t => {
  const f = await fixture(t);
  await f.command('uname', 'if [[ "$1" == -s ]]; then echo Darwin; else echo arm64; fi');
  await f.command('xcode-select', 'exit 0');
  f.env.HALO_INSTALL_DIR = join(f.directory, 'existing');
  await mkdir(f.env.HALO_INSTALL_DIR);
  await writeFile(join(f.env.HALO_INSTALL_DIR, 'keep.txt'), 'keep this');
  const result = f.run(join(root, 'install.sh'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /is not a Halo checkout/);
  assert.equal(await readFile(join(f.env.HALO_INSTALL_DIR, 'keep.txt'), 'utf8'), 'keep this');
});

test('the command resolves its checkout when invoked through a symlink', async t => {
  const f = await fixture(t);
  const checkout = join(f.directory, 'Halo checkout');
  await mkdir(join(checkout, 'artifacts/Halo.app'), { recursive: true });
  await writeFile(join(checkout, 'halo'), await readFile(join(root, 'halo')));
  const shortcut = join(f.directory, 'halo shortcut');
  await symlink(join(checkout, 'halo'), shortcut);
  await f.command('open', 'printf "%s" "$1" > "$HOME/opened.txt"');
  const linked = f.run(shortcut);
  assert.equal(linked.status, 0);
  assert.equal(await readFile(join(f.directory, 'opened.txt'), 'utf8'), join(checkout, 'artifacts/Halo.app'));
});
