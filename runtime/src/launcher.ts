import { spawn, type ChildProcess } from 'node:child_process';
import { open, readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from 'node:net';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { webBuildNeeded, recordWebBuild } from './startup-cache.ts';
import { ROOT, delay, errorText } from './config.ts';
import { sessionToken } from './server.ts';

export async function listening(port: number) {
  return new Promise<boolean>(done => { const socket = connect({ host: '127.0.0.1', port }); socket.setTimeout(250); socket.once('connect', () => { socket.destroy(); done(true); }); socket.once('error', () => done(false)); socket.once('timeout', () => { socket.destroy(); done(false); }); });
}
async function run(command: string, args: string[], options: Parameters<typeof spawn>[2], input?: string) {
  const child = spawn(command, args, options); if (input !== undefined) child.stdin!.end(input);
  const [code] = await once(child, 'exit'); if (code !== 0) throw new Error(command + ' failed. Read logs/convex.log and logs/web-build.log.');
}
export async function main() {
  const began = performance.now(); const timings: Record<string, number> = {};
  const mark = (phase: string) => { timings[phase] = Math.round(performance.now() - began); };
  const web = join(ROOT, 'web'); const envfile = join(web, '.env.local');
  if (existsSync(envfile)) {
    const settings = Object.fromEntries((await readFile(envfile, 'utf8')).split('\n').filter(line => line.includes('=') && !line.startsWith('#')).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
    if (!/^(anonymous|local):/.test(settings.CONVEX_DEPLOYMENT ?? '') || settings.VITE_CONVEX_URL !== 'http://127.0.0.1:3210') throw new Error('Halo requires this project’s local Convex deployment on port 3210.');
  }
  if ((await Promise.all([8765, 3210, 3211].map(listening))).some(Boolean)) throw new Error('Halo or Convex is already running. Stop those project processes first.');
  const token = await sessionToken();
  const env = { ...process.env, CONVEX_AGENT_MODE: 'anonymous', HALO_SESSION_TOKEN: token, HALO_CONVEX_URL: 'http://127.0.0.1:3210', NODE_OPTIONS: (process.env.NODE_OPTIONS ?? '') + ' --require ' + JSON.stringify(join(ROOT, 'scripts/convex_loopback.cjs')) };
  mkdirSync(join(ROOT, 'logs'), { recursive: true });
  const logs = [await open(join(ROOT, 'logs/convex.log'), 'a'), await open(join(ROOT, 'logs/web-build.log'), 'a')];
  const children: ChildProcess[] = []; let stopped = false;
  const stop = () => { stopped = true; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    let functionsReady = false, cliOutput = '';
    const convex = spawn(join(web, 'node_modules/.bin/convex'), ['dev', '--typecheck', 'enable'], { cwd: web, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const output = (data: Buffer) => {
      writeSync(logs[0].fd, data);
      cliOutput = (cliOutput + data.toString()).slice(-8192);
      if (cliOutput.includes('Convex functions ready!')) functionsReady = true;
    };
    convex.stdout!.on('data', output); convex.stderr!.on('data', output);
    const authorized = async () => {
      try {
        const response = await fetch('http://127.0.0.1:3210/api/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'workspace:list', args: { token }, format: 'json' }), signal: AbortSignal.timeout(1000) });
        return (await response.json()).status === 'success';
      } catch { return false; }
    };
    children.push(convex); let childError: Error | null = null; convex.once('error', error => { childError = error; });
    for (let attempt = 0; ; attempt++) {
      if (stopped) return;
      if (childError || convex.exitCode !== null) throw new Error('Convex stopped. Read logs/convex.log.');
      if (existsSync(envfile) && await listening(3210)) break;
      if (attempt >= 1200) throw new Error('Convex did not start. Read logs/convex.log.');
      await delay(100);
    }
    mark('backendListeningMs');
    // The persistent local backend normally already holds this session token.
    if (!await authorized()) await run(join(web, 'node_modules/.bin/convex'), ['env', 'set', 'HALO_SESSION_TOKEN'], { cwd: web, env, stdio: ['pipe', 'ignore', logs[0].fd] }, token);
    mark('sessionConfiguredMs');
    for (let attempt = 0; ; attempt++) {
      if (stopped) return;
      if (convex.exitCode !== null) throw new Error('Convex stopped. Read logs/convex.log.');
      if (functionsReady && await authorized()) break;
      if (attempt >= 600) throw new Error('Convex functions did not become ready.');
      await delay(100);
    }
    mark('convexReadyMs');
    if (await webBuildNeeded(ROOT)) {
      await run('npm', ['run', 'build'], { cwd: web, env, stdio: ['ignore', logs[1].fd, logs[1].fd] });
      await recordWebBuild(ROOT);
    }
    mark('webBuiltMs');
    const executor = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { cwd: join(ROOT, 'runtime'), env, stdio: 'inherit', detached: true });
    children.push(executor); executor.once('error', error => { childError = error; });
    mark('executorSpawnedMs');
    await writeFile(join(ROOT, 'logs/startup-runtime.json'), JSON.stringify(timings, null, 2));
    console.log('Halo: http://127.0.0.1:8765 · local Convex: 3210. No model or VM was started.');
    while (!stopped) {
      if (childError || children.some(child => child.exitCode !== null || child.signalCode !== null)) throw new Error('A Halo process stopped. Read logs/convex.log.');
      await delay(500);
    }
  } finally {
    for (const child of children.reverse()) {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        try { process.kill(-child.pid, 'SIGTERM'); } catch { continue; }
        const deadline = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* Already stopped. */ } }, 60000);
        await exited; clearTimeout(deadline);
      }
    }
    for (const file of logs) await file.close();
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main().catch(error => { console.error(errorText(error)); process.exitCode = 1; });
