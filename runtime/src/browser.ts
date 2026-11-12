import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ROOT, delay, pngBuffer } from './config.ts';
import type { Guest } from './guest.ts';

const BOOTSTRAP = `set -eu
umask 077
mkdir -p /dev/shm/holo-private /tmp/holo-downloads /tmp/holo-browser-env
chmod 700 /dev/shm/holo-private
command -v node >/dev/null
command -v npm >/dev/null
npm install --prefix /tmp/holo-browser-env --no-audit --no-fund playwright-core@1.59.0 >/tmp/holo-browser-setup.log 2>&1
export DISPLAY=:1
BROWSER=$(command -v chromium || command -v chromium-browser || command -v google-chrome)
nohup "$BROWSER" --user-data-dir=/tmp/holo-browser-profile --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --no-first-run about:blank >/tmp/holo-browser.log 2>&1 </dev/null &
nohup node /tmp/holo-browser-env/guest-browser.mjs --serve >/tmp/holo-browser-service.log 2>&1 </dev/null &
`;
export class PrivacyViewBlocked extends Error { constructor() { super('Private view blocked: this page cannot be masked safely. Stop the sandbox before continuing.'); } }
export class BrowserCaptureFailed extends Error { constructor() { super("The browser action may have completed, but its screenshot failed. Refresh the sandbox before continuing. The action was not retried."); } }
export class PrivateLoginRequired extends Error { constructor() { super('Use the private login form for credential fields.'); } }
export interface Browser {
  origin: string | null;
  lastTarget: string | null;
  prepare(): Promise<void>;
  call(operation: string, args?: Record<string, unknown>): Promise<Buffer>;
}
export class BrowserSession implements Browser {
  origin: string | null = null;
  lastTarget: string | null = null;
  constructor(private guest: Guest) {}
  async prepare() {
    const setup = await this.guest.shell('umask 077; mkdir -p /tmp/holo-browser-env /dev/shm/holo-private; chmod 700 /dev/shm/holo-private');
    if (!setup.success) throw new Error('Guest browser directory setup failed.');
    await this.guest.writeText('/tmp/holo-browser-env/guest-browser.mjs', await readFile(join(ROOT, 'runtime/src/guest-browser.mjs'), 'utf8'));
    if (!(await this.guest.shell(BOOTSTRAP, 180000)).success) throw new Error('Guest browser setup failed. The VM needs Node.js, npm, Chromium, and internet access.');
    await delay(2000);
    await this.call('screen');
  }
  async call(operation: string, args: Record<string, unknown> = {}) {
    const request_id = randomBytes(16).toString('hex');
    try {
      await this.guest.writeText('/dev/shm/holo-private/request.json', JSON.stringify({ ...args, operation, request_id }));
      const response = await this.guest.shell('node /tmp/holo-browser-env/guest-browser.mjs', 45000);
      if (!response.success) throw new Error();
      const data = JSON.parse(response.stdout);
      if (data.request_id !== request_id) throw new Error();
      if (data.error_code === 'private-login-required') throw new PrivateLoginRequired();
      if (data.error_code === 'privacy-blocked') throw new PrivacyViewBlocked();
      if (data.error_code === 'capture-failed') throw new BrowserCaptureFailed();
      if (data.ok !== true) throw new Error();
      const png = pngBuffer(await this.guest.readBytes('/dev/shm/holo-private/screen.png'));
      this.origin = typeof data.origin === 'string' ? data.origin : null;
      this.lastTarget = typeof data.target_label === 'string' && data.target_label.length <= 120 ? data.target_label : null;
      return png;
    } catch (error) {
      if (error instanceof PrivacyViewBlocked || error instanceof PrivateLoginRequired || error instanceof BrowserCaptureFailed) throw error;
      throw new Error('The guest browser operation failed. No action was retried. Refresh or stop the sandbox.');
    } finally { await this.guest.remove('/dev/shm/holo-private/request.json').catch(() => {}); }
  }
}
