import './config.ts';
import { accessSync, constants, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SandboxLike, SpacesdClientLike } from '@trycua/cua';
import { CUA_HOME, IMAGE, errorText, delay } from './config.ts';
export interface Guest {
  id: string;
  screenshot(): Promise<{ png: Buffer; width: number; height: number }>;
  click(x: number, y: number): Promise<void>;
  type(text: string): Promise<void>;
  key(keys: string[]): Promise<void>;
  scroll(x: number, y: number, direction: string): Promise<void>;
  writeText(path: string, text: string): Promise<void>;
  readBytes(path: string): Promise<Buffer>;
  remove(path: string): Promise<void>;
  list(path: string): Promise<{ name: string; size: number | null; is_dir: boolean }[]>;
  shell(command: string, timeout?: number): Promise<{ success: boolean; stdout: string; stderr: string }>;
  destroy(): Promise<void>;
}
export interface GuestFactory { create(name: string, network: boolean): Promise<Guest>; recover(name: string): Promise<void> }
function executable(name: string) {
  return (process.env.PATH ?? '').split(':').some(dir => { try { accessSync(join(dir, name), constants.X_OK); return true; } catch { return false; } });
}
export class CuaGuest implements Guest {
  readonly id: string;
  constructor(private sandbox: SandboxLike, private client: SpacesdClientLike) { this.id = sandbox.id(); }
  async screenshot() { const s = await this.client.screenshot(undefined, { signal: AbortSignal.timeout(20000) }); return { png: Buffer.from(s.image), width: s.width, height: s.height }; }
  async click(x: number, y: number) { await this.client.click(x, y, { signal: AbortSignal.timeout(15000) }); }
  async type(text: string) { await this.client.typeText(text, { signal: AbortSignal.timeout(15000) }); }
  async key(keys: string[]) { await this.client.hotkey(keys, { signal: AbortSignal.timeout(15000) }); }
  async scroll(x: number, y: number, direction: string) { await this.client.moveTo(x, y); await this.client.scroll(0, direction === 'up' ? -3 : 3, { signal: AbortSignal.timeout(15000) }); }
  async writeText(path: string, text: string) {
    const { UploadOptions } = await import('@trycua/cua');
    const data = new TextEncoder().encode(text);
    await this.client.upload(path, data.buffer, UploadOptions.create({}), { signal: AbortSignal.timeout(30000) });
  }
  async readBytes(path: string) {
    // Read bounded chunks; a hostile guest cannot force an unlimited screenshot allocation.
    const stream = await this.client.openDownload(path, 65536, undefined, { signal: AbortSignal.timeout(20000) });
    const chunks: Buffer[] = []; let length = 0;
    try { for (;;) { const chunk = await stream.nextChunk({ signal: AbortSignal.timeout(20000) }); if (!chunk) break; const data = Buffer.from(chunk); length += data.length; if (length > 15_000_000) throw new Error('Guest file exceeds the screenshot limit.'); chunks.push(data); } }
    finally { stream.cancel(); }
    return Buffer.concat(chunks);
  }
  async remove(path: string) { await this.client.remove(path, false, undefined, { signal: AbortSignal.timeout(10000) }); }
  async list(path: string) { return (await this.client.listDir(path, 1, undefined, undefined, { signal: AbortSignal.timeout(10000) })).map(e => ({ name: e.name, size: Number(e.size), is_dir: e.kind === 'directory' })); }
  async shell(command: string, timeout = 15000) { const r = await this.client.sh(command, timeout, { signal: AbortSignal.timeout(timeout + 5000) }); return { success: r.exit.code === 0, stdout: Buffer.from(r.stdout).toString('utf8'), stderr: Buffer.from(r.stderr).toString('utf8') }; }
  async destroy() { await this.sandbox.delete_(); }
}
async function sdk() {
  const { embedded } = await import('@trycua/cua');
  return embedded({ accountFromSession: false, stateDir: join(CUA_HOME, 'sandboxes'), spacesHome: CUA_HOME }).sandboxes();
}
export class LocalGuestFactory implements GuestFactory {
  async create(name: string, network: boolean): Promise<Guest> {
    if (!executable('qemu-system-aarch64') || !executable('qemu-img')) throw new Error('QEMU is missing. Run brew install qemu, then restart Halo.');
    if (network && !((process.env.CUA_NETGW && existsSync(process.env.CUA_NETGW)) || executable('cua-netgw'))) throw new Error('Online mode needs the Cua network gateway. Run bash scripts/poc.sh setup.');
    const { SandboxCreateOptions } = await import('@trycua/cua');
    const sandboxes = await sdk();
    const sandbox = await sandboxes.create(SandboxCreateOptions.create({ image: IMAGE, name, on: 'local', kind: 'vm', runtime: 'qemu', network: network ? 'default' : 'none', cpus: 4, memoryMb: 2048n }));
    // The create record has no disk-size field in 0.21.0. Match the previous 30 GiB shape explicitly.
    try {
      await sandbox.resize(undefined, undefined, 30);
      // Resizing reboots QEMU. Reattach to the persisted endpoint and allow the
      // guest agent the same readiness budget as the prior Python transport.
      const resized = await sandboxes.connect('local:' + name);
      return new CuaGuest(resized, await waitForGuestAgent(resized));
    }
    catch (error) {
      await sandbox.delete_().catch(() => {});
      const detail = errorText(error).replace(/https?:\/\/\S+/g, '[guest endpoint]').slice(0, 800);
      throw new Error('Guest setup failed. Retry Stop before starting again. ' + detail);
    }
  }
  async recover(name: string) {
    if (!/^holo-poc-[0-9a-f]{8}$/.test(name)) throw new Error('Invalid POC ownership record. Refusing guest cleanup.');
    const sandboxes = await sdk();
    try { await sandboxes.delete_('local:' + name); }
    catch (error) { const inventory = await sandboxes.list('local'); if (inventory.some(item => item.name === name)) throw error; }
  }
}
async function waitForGuestAgent(sandbox: SandboxLike): Promise<SpacesdClientLike> {
  // spacesd(probeTimeoutMs) bounds ONE health probe. A connection reset can
  // return immediately while Linux boots. Retry only this read-only readiness
  // probe, never a click, file write, or uncertain command.
  const deadline = Date.now() + 120000;
  let lastError: unknown;
  do {
    try { return await sandbox.spacesd(2000); }
    catch (error) { lastError = error; await delay(500); }
  } while (Date.now() < deadline);
  throw lastError;
}
