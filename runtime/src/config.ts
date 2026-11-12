import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const CUA_HOME = resolve(ROOT, '.cache/cua-poc');
export const OWNED = resolve(CUA_HOME, 'owned-sandbox.json');
export const IMAGE = 'ghcr.io/trycua/linux:24.04-disk';
export const ORIGIN = 'http://127.0.0.1:8765';
process.env.CUA_HOME = CUA_HOME;
process.env.CUA_TELEMETRY = '0';
process.env.DO_NOT_TRACK = '1';
process.env.CUA_VM_MIN_AVAILABLE_MB ??= '4096';
const gateway = resolve(ROOT, '.cache/cua-netgw/cua-netgw');
if (!process.env.CUA_NETGW && existsSync(gateway)) process.env.CUA_NETGW = gateway;

export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  async use<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(done => { release = done; });
    await previous;
    try { return await work(); } finally { release(); }
  }
}
export const delay = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
export const errorText = (error: unknown) => error instanceof Error ? error.message : 'Operation failed.';
export function pngBuffer(value: Uint8Array): Buffer {
  const png = Buffer.from(value);
  if (png.length > 15_000_000 || !png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('Guest returned an invalid screenshot.');
  return png;
}
