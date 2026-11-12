import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { pngBuffer } from './config.ts';

export type ScreenshotAttachment = { id: string; caption: string; createdAt: number };
export class Screenshots {
  constructor(readonly directory: string) {}
  async save(png: Uint8Array, caption: string): Promise<ScreenshotAttachment> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if ((await readdir(this.directory)).filter(name => name.endsWith('.png')).length >= 50) throw new Error('This thread has 50 saved screenshots. Start another thread to capture more.');
    const id = randomBytes(16).toString('hex');
    await writeFile(join(this.directory, id + '.png'), pngBuffer(png), { flag: 'wx', mode: 0o600 });
    return { id, caption, createdAt: Date.now() };
  }
  async read(id: string) {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid screenshot ID.');
    try { return pngBuffer(await readFile(join(this.directory, id + '.png'))); }
    catch { throw new Error('Saved screenshot is unavailable on this Mac.'); }
  }
}
