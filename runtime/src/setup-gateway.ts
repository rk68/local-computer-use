import './config.ts';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './config.ts';

const cache = join(ROOT, '.cache/cua-netgw');
function run(command: string, args: string[], cwd?: string, env = process.env): string {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('Gateway setup failed: ' + command + '. ' + (result.stderr ?? '').slice(-1000));
  return result.stdout.trim();
}
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Gateway setup supports Apple silicon Macs. Configure CUA_NETGW on other systems.');
await mkdir(cache, { recursive: true });
const binary = join(cache, 'cua-netgw');
if (existsSync(binary)) {
  if (run(binary, ['-version']) !== 'cua-netgw 0.21.0') throw new Error('Unexpected gateway version. Inspect the project cache before replacing it.');
} else {
  const archive = join(cache, 'go1.26.10.darwin-arm64.tar.gz');
  if (!existsSync(archive)) {
    console.log('Downloading the pinned Go toolchain into the project cache.');
    const response = await fetch('https://go.dev/dl/go1.26.10.darwin-arm64.tar.gz', { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error('Go toolchain download failed.');
    await writeFile(archive + '.part', Buffer.from(await response.arrayBuffer())); await rename(archive + '.part', archive);
  }
  if (createHash('sha256').update(await readFile(archive)).digest('hex') !== '0b5183492292ada170f9b561a834863808dd02edba599e4ad0e89899330020b3') throw new Error('Go toolchain checksum mismatch. No downloaded code was executed.');
  const toolchain = join(cache, 'toolchain'); const compiler = join(toolchain, 'go/bin/go');
  if (!existsSync(compiler)) { await mkdir(toolchain, { recursive: true }); run('tar', ['-xzf', archive, '-C', toolchain]); }
  const source = join(cache, 'source');
  if (!existsSync(source)) run('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--branch', 'cua-sdk-v0.21.0', 'https://github.com/trycua/cua.git', source]);
  if (run('git', ['-C', source, 'rev-parse', 'HEAD']) !== 'a4ec97ee94dc04332dacbca635886e03d8c27e8d') throw new Error('Cua source revision mismatch. Build stopped.');
  run('git', ['-C', source, 'sparse-checkout', 'set', 'libs/cua/netgw']);
  run(compiler, ['build', '-p', '2', '-trimpath', '-ldflags', '-s -w -X main.version=0.21.0', '-o', binary, './cmd/cua-netgw'], join(source, 'libs/cua/netgw'), { ...process.env, GOTOOLCHAIN: 'local', GOMAXPROCS: '2', GOMEMLIMIT: '512MiB', CGO_ENABLED: '0', GOPATH: join(cache, 'gopath'), GOCACHE: join(cache, 'build-cache') });
  run('codesign', ['--force', '--sign', '-', '--identifier', 'ai.cua.netgw', binary]);
  if (run(binary, ['-version']) !== 'cua-netgw 0.21.0') throw new Error('Gateway version check failed.');
}
console.log('Project-local Cua network gateway: ready.');
