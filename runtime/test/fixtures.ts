import type { Guest } from '../src/guest.ts';
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA7sAAAAASUVORK5CYII=', 'base64');
export class FakeGuest implements Guest {
  calls: unknown[][] = []; failDestroy = false; files = new Map<string, string>();
  constructor(readonly id: string) {}
  async screenshot() { return { png: PNG, width: 1280, height: 800 }; }
  async click(x: number, y: number) { this.calls.push(['click', x, y]); }
  async type(text: string) { this.calls.push(['type', text]); }
  async key(keys: string[]) { this.calls.push(['key', keys]); }
  async scroll(x: number, y: number, direction: string) { this.calls.push(['scroll', x, y, direction]); }
  async writeText(path: string, text: string) { this.files.set(path, text); }
  async readBytes(_path: string) { return PNG; }
  async remove(path: string) { this.files.delete(path); }
  async list(_path: string) { return [{ name: 'report.pdf', size: 42, is_dir: false }]; }
  async shell(_command: string, _timeout?: number) { return { success: true, stdout: '{}', stderr: '' }; }
  async destroy() { if (this.failDestroy) throw new Error('Fixture delete failure'); this.calls.push(['destroy']); }
}
export function tool(name: string, args: object) { return { choices: [{ finish_reason: 'tool_calls', message: { content: '', tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } }] }; }
