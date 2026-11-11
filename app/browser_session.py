"""Host-side broker for a browser running inside a Cua VM."""
import asyncio
import json
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOOTSTRAP = """set -eu
umask 077
mkdir -p /dev/shm/holo-private /tmp/holo-downloads
chmod 700 /dev/shm/holo-private
python3 -m venv /tmp/holo-browser-env
/tmp/holo-browser-env/bin/pip -q install playwright==1.59.0 >/tmp/holo-browser-setup.log 2>&1
export DISPLAY=:1
BROWSER=$(command -v chromium || command -v chromium-browser || command -v google-chrome)
nohup "$BROWSER" --user-data-dir=/tmp/holo-browser-profile --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --no-first-run about:blank >/tmp/holo-browser.log 2>&1 </dev/null &
nohup /tmp/holo-browser-env/bin/python /tmp/holo-browser.py --serve >/tmp/holo-browser-service.log 2>&1 </dev/null &
"""


class PrivacyViewBlocked(RuntimeError):
    def __init__(self):
        super().__init__('Private view blocked: this page cannot be masked safely. Stop the sandbox before continuing.')


class BrowserSession:
    def __init__(self, guest):
        self.guest = guest
        self.origin = None
        self.screen = None

    async def prepare(self):
        await self.guest.files.write_text('/tmp/holo-browser.py', (ROOT / 'app/guest_browser.py').read_text())
        result = await self.guest.shell.run(BOOTSTRAP, timeout=180)
        if not result.success:
            raise RuntimeError('Guest browser setup failed. The VM needs Python venv support, Chromium, and internet access.')
        await asyncio.sleep(2)
        await self.call('screen')

    async def call(self, operation, **arguments):
        request_id = secrets.token_hex(16)
        try:
            await self.guest.files.write_text('/dev/shm/holo-private/request.json', json.dumps({'operation': operation, 'request_id': request_id, **arguments}))
            result = await self.guest.shell.run('/tmp/holo-browser-env/bin/python /tmp/holo-browser.py', timeout=45)
            if not result.success:
                raise ValueError
            data = json.loads(result.stdout)
            if data.get('request_id') != request_id:
                raise ValueError
            if data.get('error_code') == 'privacy-blocked':
                raise PrivacyViewBlocked
            if data.get('ok') is not True:
                raise ValueError
            png = await self.guest.files.read_bytes('/dev/shm/holo-private/screen.png', length=15_000_001)
            if not png.startswith(b'\x89PNG\r\n\x1a\n') or len(png) > 15_000_000:
                raise ValueError
            self.screen = png
            self.origin = data.get('origin')
            return png
        except PrivacyViewBlocked:
            raise
        except Exception:
            # Neither SDK errors nor browser errors may quote a credential payload.
            raise RuntimeError('The guest browser operation failed. No action was retried. Refresh or stop the sandbox.') from None
        finally:
            try:
                await self.guest.files.remove('/dev/shm/holo-private/request.json')
            except Exception:
                pass
