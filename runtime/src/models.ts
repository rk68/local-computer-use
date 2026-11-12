import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename, stat, statfs, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { once } from 'node:events';
import { z } from 'zod';
import { ROOT, Mutex, delay } from './config.ts';

type ModelFile = { name: string; size: number; sha256: string; role?: 'weights' | 'projector' };
export type ModelSpec = { id: string; name: string; detail: string; license: string; repo: string; revision: string; directory: string; provenance?: string; note?: string; files: ModelFile[] };
export const MODEL_CATALOG: ModelSpec[] = [
  { id: 'holo4-35b-a3b', name: 'Holo4 · 35B A3B', detail: 'Mixture of experts · Q4_K_M · 22.2 GB', license: 'Apache 2.0', repo: 'Hcompany/Holo4-35B-A3B-GGUF', revision: '93400a4734519493de4f49910de1f6e0e24be46b', directory: 'holo4', files: [
    { name: 'q4_k_m.gguf', size: 21297870912, sha256: '4c51212a4b5673d6a4215b9d708cd1730f1b6b4dbb5f75552df18de8341ce669' },
    { name: 'mmproj.f16.gguf', size: 899282976, sha256: 'e1076d4179a6d82dbc7f129f043ac5cb03e4584ef5c1ed4a0c31eca5d1a187e4' },
  ] },
  { id: 'holo4-27b', name: 'Holo4 · 27B', detail: 'Dense · Q4_K_M · 17.8 GB', license: 'CC BY-NC 4.0 · non-commercial', repo: 'Hcompany/Holo4-27B-GGUF', revision: '045834b6864fb5cee8e9c72e47ef4c19140ce932', directory: 'holo4-27b', files: [
    { name: 'q4_k_m.gguf', size: 16875182592, sha256: '8071d3ed5f59c88282e6466add0b344b51d49c8c630ae8f93d673ac0911ab962' },
    { name: 'mmproj.f16.gguf', size: 927606816, sha256: 'b4038c228fcf84b0528e327c314204d165f6fa97ebb74d766424f49d2eba0d9c' },
  ] },
  {
    "id": "holo31-08b",
    "note": "Reads images and emits tool calls; exact instructions and click accuracy were unreliable in a local check.",
    "name": "Holo 3.1 · 0.8B",
    "detail": "Q4_K_M + F16 vision · 0.88 GB download",
    "license": "Apache 2.0",
    "provenance": "Community GGUF · experimental",
    "repo": "mradermacher/Holo-3.1-0.8B-GGUF",
    "revision": "a78bdf3064781ab564fcc7e189bd49765809820b",
    "directory": "holo31-08b",
    "files": [
      {
        "name": "Holo-3.1-0.8B.Q4_K_M.gguf",
        "size": 672330784,
        "sha256": "b591d94d48d425170057668d35531db1f5556384f41b172009656b58b110df15",
        "role": "weights"
      },
      {
        "name": "Holo-3.1-0.8B.mmproj-f16.gguf",
        "size": 204987776,
        "sha256": "e1df4bc8a7b5f560c22ecdd1d0f3ba78ade62fb37c965b4020b805df1a5231c7",
        "role": "projector"
      }
    ]
  },
  {
    "id": "holo31-4b",
    "note": "Desktop workflow validation pending. Not yet run on this Mac.",
    "name": "Holo 3.1 · 4B",
    "detail": "Q4_K_M + F16 vision · 3.74 GB download",
    "license": "Apache 2.0",
    "provenance": "Community GGUF · experimental",
    "repo": "prithivMLmods/Holo-3.1-4B-GGUF",
    "revision": "c34254d35dd0f02af73f3e804abfcbc24cb0bb8a",
    "directory": "holo31-4b",
    "files": [
      {
        "name": "Holo-3.1-4B.Q4_K_M.gguf",
        "size": 3066386016,
        "sha256": "44eaed360316d00fb66c2df346b3e307e8539aa08bb2ffca9a368fabfdfdab12",
        "role": "weights"
      },
      {
        "name": "Holo-3.1-4B.mmproj-f16.gguf",
        "size": 675569984,
        "sha256": "cc161b66cf68c15245ef0c86358481a709c6ea2af1e157e9a92d70a25bee0e39",
        "role": "projector"
      }
    ]
  },
  {
    "id": "holo31-9b",
    "note": "Desktop workflow validation pending. Not yet run on this Mac.",
    "name": "Holo 3.1 · 9B",
    "detail": "Q4_K_M + F16 vision · 6.55 GB download",
    "license": "Apache 2.0",
    "provenance": "Community GGUF · experimental",
    "repo": "prithivMLmods/Holo-3.1-9B-GGUF",
    "revision": "a007835baf4bfb0211a102e289194bd91e5f317a",
    "directory": "holo31-9b",
    "files": [
      {
        "name": "Holo-3.1-9B.Q4_K_M.gguf",
        "size": 5629109728,
        "sha256": "fb5482e5039b26a3916b35577184ff6ea881f29bda959d534fc6ef9041724c21",
        "role": "weights"
      },
      {
        "name": "Holo-3.1-9B.mmproj-f16.gguf",
        "size": 921705568,
        "sha256": "60b0e27cdc6a3ceb09ea1b6301254abc48eafb396b2335be72e3a8e70b731b22",
        "role": "projector"
      }
    ]
  },
];
export function modelArgs(spec: ModelSpec, root = ROOT) {
  const directory = join(root, 'models', spec.directory);
  const weights = spec.files.find(file => file.role === 'weights')?.name ?? 'q4_k_m.gguf';
  const projector = spec.files.find(file => file.role === 'projector')?.name ?? 'mmproj.f16.gguf';
  return ['--model', join(directory, weights), '--mmproj', join(directory, projector), '--ctx-size', '8192', '--parallel', '1', '--n-gpu-layers', '999', '--jinja', '--alias', 'holo4', '--host', '127.0.0.1', '--port', '8080', '--offline'];
}
export class ModelManager {
  readonly lock = new Mutex();
  selectedId = MODEL_CATALOG[0].id;
  phase = 'off'; error: string | null = null; progress: { model_id: string; bytes: number; total: number } | null = null;
  private child: ChildProcess | null = null; private work: Promise<unknown> | null = null; private downloadAbort: AbortController | null = null;
  private generation = 0; private loaded = false; private holdsGate = false;
  constructor(private busy: () => Promise<boolean>, private root = ROOT, private catalog = MODEL_CATALOG, private gate?: (changing: boolean) => Promise<void>) { this.selectedId = catalog[0].id; }
  private async setGate(changing: boolean) {
    if (!changing && !this.holdsGate) return;
    await this.gate?.(changing); this.holdsGate = changing;
  }
  async recoverGate() { await this.gate?.(false); this.holdsGate = false; }
  private async load() {
    if (this.loaded) return; this.loaded = true;
    try { const saved = JSON.parse(await readFile(join(this.root, '.cache/halo/model-selection.json'), 'utf8')); if (this.catalog.some(m => m.id === saved.id)) this.selectedId = saved.id; } catch { /* Default selection. No automatic memory allocation. */ }
  }
  private spec(id: unknown) { const value = z.string().parse(id); const model = this.catalog.find(m => m.id === value); if (!model) throw new Error('Choose a supported local model.'); return model; }
  private path(spec: ModelSpec, file: ModelFile) { return join(this.root, 'models', spec.directory, file.name); }
  async installed(spec: ModelSpec) {
    for (const file of spec.files) { try { if ((await stat(this.path(spec, file))).size !== file.size) return false; } catch { return false; } }
    return true;
  }
  async snapshot() {
    await this.load();
    let ready = false;
    try { const response = await fetch('http://127.0.0.1:8080/health', { signal: AbortSignal.timeout(1000) }); ready = response.ok && (await response.json()).status === 'ok'; } catch { /* Off or still loading. */ }
    if (this.child && ready && this.phase === 'starting') { await this.setGate(false); this.phase = 'ready'; }
    return { selected_id: this.selectedId, phase: !this.child && ready ? 'external' : this.phase, ready, managed: !!this.child, error: this.error, progress: this.progress,
      models: await Promise.all(this.catalog.map(async spec => ({ id: spec.id, name: spec.name, detail: spec.detail, license: spec.license, provenance: spec.provenance ?? 'Official GGUF', ...(spec.note ? { note: spec.note } : {}), installed: await this.installed(spec), source: 'https://huggingface.co/' + spec.repo }))) };
  }
  private launch(work: () => Promise<unknown>) {
    if (this.work) throw new Error('A model operation is already running.');
    this.error = null;
    const promise = work().catch(() => { this.phase = 'failed'; this.error = 'Model operation failed. Read logs/model.log, check free memory and disk space, then retry.'; }).finally(() => { if (this.work === promise) this.work = null; });
    this.work = promise;
  }
  async start(id: unknown) {
    const spec = this.spec(id);
    return this.lock.use(async () => {
      if (this.work) throw new Error('A model operation is already running.');
      if (await this.busy()) throw new Error('Wait for all bots to finish before switching models.');
      if (!await this.installed(spec)) throw new Error('Download both model files before starting this model.');
      const state = await this.snapshot();
      if (state.phase === 'external') throw new Error('A separately started model uses port 8080. Stop it in its terminal before using app-managed models.');
      if (this.child && this.selectedId === spec.id && ['starting', 'ready'].includes(this.phase)) return { accepted: true };
      await this.setGate(true);
      try {
        await this.stopChild();
        // Also detect a listening model that is loading and does not yet pass /health.
        const { connect } = await import('node:net');
        const occupied = await new Promise<boolean>(done => { const socket = connect({ host: '127.0.0.1', port: 8080 }); socket.setTimeout(500); socket.once('connect', () => { socket.destroy(); done(true); }); socket.once('error', () => done(false)); socket.once('timeout', () => { socket.destroy(); done(false); }); });
        if (occupied) throw new Error('Port 8080 is occupied. Stop the separately started service before loading a model.');
        this.selectedId = spec.id; this.phase = 'starting'; this.error = null; const generation = ++this.generation;
        await mkdir(join(this.root, '.cache/halo'), { recursive: true });
        await writeFile(join(this.root, '.cache/halo/model-selection.json'), JSON.stringify({ id: spec.id }), { mode: 0o600 });
        await mkdir(join(this.root, 'logs'), { recursive: true });
        const log = await open(join(this.root, 'logs/model.log'), 'w');
        const child = spawn('llama-server', modelArgs(spec, this.root), { cwd: this.root, stdio: ['ignore', log.fd, log.fd], env: { ...process.env, HF_HUB_OFFLINE: '1' } });
        this.child = child;
        child.once('error', () => { if (this.child === child) { this.child = null; this.phase = 'failed'; this.error = 'llama-server could not start. Install llama.cpp with Homebrew and retry.'; void this.setGate(false).catch(() => {}); } });
        child.once('exit', () => { if (this.child === child) { this.child = null; this.phase = 'failed'; this.error = 'The model process stopped. Read logs/model.log and check available memory.'; void this.setGate(false).catch(() => {}); } });
        await log.close();
        // Poll readiness independently, so startup never holds the HTTP response open.
        void (async () => {
          for (let attempt = 0; attempt < 360 && this.child === child && generation === this.generation; attempt++) {
            const state = await this.snapshot(); if (state.ready) return; await delay(1000);
          }
          if (this.child === child && generation === this.generation) { await this.stopChild(); await this.setGate(false); this.phase = 'failed'; this.error = 'Model startup timed out. Read logs/model.log.'; }
        })().catch(() => { this.phase = 'failed'; this.error = 'The model readiness check failed. Unload and retry.'; });
        return { accepted: true };
      } catch (error) { await this.setGate(false); throw error; }
    });
  }
  private async stopChild() {
    const child = this.child; this.child = null; this.generation++;
    if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
    this.phase = 'stopping'; const exited = once(child, 'exit'); child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    try { await exited; } finally { clearTimeout(timer); }
  }
  async stop() {
    return this.lock.use(async () => {
      if (await this.busy()) throw new Error('Wait for all bots to finish before stopping the model.');
      this.downloadAbort?.abort(); if (this.work) await this.work;
      await this.setGate(true);
      try { await this.stopChild(); this.phase = 'off'; this.error = null; this.progress = null; }
      finally { await this.setGate(false); }
      return { accepted: true };
    });
  }
  async download(id: unknown) {
    const spec = this.spec(id);
    return this.lock.use(async () => {
      if (this.work) throw new Error('A model operation is already running.');
      if (this.child) throw new Error('Stop the current model before downloading another one.');
      if (await this.busy()) throw new Error('Wait for all bots to finish first.');
      const directory = join(this.root, 'models', spec.directory); await mkdir(directory, { recursive: true });
      const disk = await statfs(directory); const needed = spec.files.reduce((n, f) => n + f.size, 0);
      if (disk.bavail * disk.bsize < needed + 1024 ** 3) throw new Error('There is not enough free disk space for this model.');
      this.phase = 'downloading'; this.downloadAbort = new AbortController(); const signal = this.downloadAbort.signal;
      this.progress = { model_id: spec.id, bytes: 0, total: needed };
      this.launch(async () => {
        for (const file of spec.files) await this.downloadFile(spec, file, signal);
        this.phase = 'off'; this.progress = null; this.downloadAbort = null;
      });
      return { accepted: true };
    });
  }
  private async downloadFile(spec: ModelSpec, file: ModelFile, signal: AbortSignal) {
    const path = this.path(spec, file), partial = path + '.part';
    if (existsSync(path) && (await stat(path)).size === file.size && await digest(path) === file.sha256) { this.progress!.bytes += file.size; return; }
    let offset = existsSync(partial) ? (await stat(partial)).size : 0;
    if (offset > file.size) { await writeFile(partial, ''); offset = 0; }
    if (offset === file.size) {
      if (await digest(partial) === file.sha256) { await rename(partial, path); this.progress!.bytes += file.size; return; }
      await writeFile(partial, ''); offset = 0;
    }
    const response = await fetch(`https://huggingface.co/${spec.repo}/resolve/${spec.revision}/${file.name}?download=true`, { signal, headers: offset ? { Range: `bytes=${offset}-` } : {} });
    if (!response.ok || !response.body) throw new Error('Model download failed.');
    if (response.status === 206 && !response.headers.get('content-range')?.startsWith(`bytes ${offset}-`)) throw new Error('Invalid resumed model download.');
    if (response.status !== 206) offset = 0;
    const output = await open(partial, offset ? 'a' : 'w'); this.progress!.bytes += offset;
    let size = offset;
    try {
      for await (const chunk of response.body) {
        size += chunk.length; if (size > file.size) throw new Error('Model download exceeds expected size.');
        let written = 0; while (written < chunk.length) written += (await output.write(chunk.subarray(written))).bytesWritten;
        this.progress!.bytes += chunk.length;
      }
    } finally { await output.close(); }
    if (size !== file.size || await digest(partial) !== file.sha256) throw new Error('Model checksum mismatch. The file was not installed.');
    await rename(partial, path);
  }
  async close() { this.downloadAbort?.abort(); if (this.work) await this.work; await this.stopChild(); await this.setGate(false).catch(() => {}); }
}
async function digest(path: string) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }
