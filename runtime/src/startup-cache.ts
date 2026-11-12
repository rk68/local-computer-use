import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile, rename, stat, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const webInputs = ['web/src', 'web/shared', 'web/public', 'web/convex', 'web/index.html', 'web/package.json', 'web/package-lock.json', 'web/node_modules/.package-lock.json', 'web/tsconfig.json', 'web/convex/tsconfig.json', 'web/vite.config.ts', 'web/vite.config.js', 'web/vite.config.mts', 'web/.env', 'web/.env.local', 'web/.env.production', 'web/.env.production.local'];
export async function fingerprint(root: string, paths: string[], extra = '') {
  const hash = createHash('sha256'); hash.update(extra);
  async function visit(path: string, ancestors: Set<string>) {
    hash.update('\0' + relative(root, path) + '\0');
    let info;
    try { info = await stat(path); } catch (error: any) { if (error.code === 'ENOENT') { hash.update('missing'); return; } throw error; }
    if (info.isDirectory()) {
      const real = await realpath(path); if (ancestors.has(real)) throw new Error('A build input contains a directory cycle.');
      const next = new Set([...ancestors, real]);
      for (const child of (await readdir(path)).filter(name => name !== '.DS_Store').sort()) await visit(join(path, child), next);
    } else hash.update(await readFile(path));
  }
  for (const path of [...paths].sort()) await visit(join(root, path), new Set());
  return hash.digest('hex');
}
function environment() {
  return JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, vite: Object.entries(process.env).filter(([key]) => key.startsWith('VITE_')).sort(([a], [b]) => a.localeCompare(b)) });
}
export async function webBuildNeeded(root: string) {
  if (!existsSync(join(root, 'web/dist/index.html'))) return true;
  try {
    const cache = JSON.parse(await readFile(join(root, '.cache/halo/web-build.json'), 'utf8'));
    return cache.version !== 1 || cache.inputs !== await fingerprint(root, webInputs, environment()) || cache.output !== await fingerprint(root, ['web/dist']);
  } catch { return true; }
}
export async function recordWebBuild(root: string) {
  const directory = join(root, '.cache/halo'); await mkdir(directory, { recursive: true });
  const value = { version: 1, inputs: await fingerprint(root, webInputs, environment()), output: await fingerprint(root, ['web/dist']) };
  const path = join(directory, 'web-build.json'), temporary = path + '.' + process.pid;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, path);
}
