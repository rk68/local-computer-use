"""Isolated browser checks with dummy pages. Never starts llama.cpp, Cua, or a VM.

Run using the optional browser-check environment described in docs/browser-checks.md.
"""
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
from pathlib import Path
import ssl
import subprocess
import sys
import tempfile
import time
import threading
from unittest.mock import patch
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app import guest_browser

USERNAME = 'dummy.person@example.test'
PASSWORD = 'TEST-ONLY-DO-NOT-USE-4729'
FIXTURE = '''<!doctype html><meta charset="utf-8"><style>
body{font:18px system-ui;background:white;color:black;padding:24px}input{display:block;width:400px;padding:12px;margin:12px 0}#echo,#changed{padding:16px;min-height:24px}canvas,svg,iframe{display:block;width:400px;height:60px;margin:12px 0}#public{padding:20px;background:#00bfa0}
</style><p id="public">Public content stays visible</p><a id="download" href="/fixture-download.txt">Download test file</a><input type="email" id="username"><input type="password" id="password"><div id="echo"></div><div id="changed"></div><canvas id="canvas" width="400" height="60"></canvas><svg id="vector" viewBox="0 0 400 60"><path d="M0 0h400v60H0Z" fill="red"/></svg><iframe srcdoc="<p>TEST-ONLY-DO-NOT-USE-4729</p>"></iframe><div id="shadow"></div><script>
username.addEventListener('input',()=>echo.textContent=username.value);
password.addEventListener('input',()=>{const c=canvas.getContext('2d');c.fillStyle='red';c.fillRect(0,0,400,60);c.fillStyle='white';c.fillText(password.value,10,30)});
</script>'''


def state_fixture():
    return dict(phase='idle', busy=False, error=None, sandbox=False, sandbox_id=None,
        messages=[], events=[], pending=None, screen=None, width=0, height=0,
        actions=0, max_actions=20, approve_all=False, network=False, browser_origin=None,
        credential_request=None, task=None)


class FixtureHandler(SimpleHTTPRequestHandler):
    state = state_fixture()
    posts = []

    def log_message(self, *args):
        pass

    def send_json(self, value):
        data = json.dumps(value).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == '/fixture-download.txt':
            body = b'fixture-only download\n'
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.send_header('Content-Disposition', 'attachment; filename=fixture-download.txt')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == '/login':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(FIXTURE.encode())
        elif self.path == '/api/session':
            self.send_json({'token': 'fixture-only-token'})
        elif self.path == '/api/state':
            self.send_json(self.state)
        elif self.path == '/api/model':
            self.send_json({'ok': False})  # Never forwards to the real model endpoint.
        else:
            super().do_GET()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path != '/api/login':
            self.send_error(400, 'Only the dummy private-login endpoint is supported.')
            return
        self.posts.append((self.path, body))
        self.state['credential_request'] = None
        self.send_json({'accepted': True})


@contextmanager
def fixture_server(cert=None):
    handler = partial(FixtureHandler, directory=str(ROOT / 'web/dist'))
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    if cert:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(*cert)
        server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'{"https" if cert else "http"}://127.0.0.1:{server.server_port}'
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def masked_pixels(page, png, selector):
    from PIL import Image
    bounds = page.locator(selector).bounding_box()
    assert bounds, f'{selector} is not visible'
    image = Image.open(BytesIO(png)).convert('RGB')
    left, top = int(bounds['x']) + 2, int(bounds['y']) + 2
    right, bottom = int(bounds['x'] + bounds['width']) - 2, int(bounds['y'] + bounds['height']) - 2
    crop = image.crop((left, top, right, bottom))
    counts = crop.getcolors(maxcolors=crop.width * crop.height) or []
    masked = sum(count for count, colour in counts if colour == (41, 41, 41))
    assert masked / (crop.width * crop.height) > .98, f'Unmasked pixels in {selector}'


def private_browser_checks(browser, base, directory):
    context = browser.new_context(ignore_https_errors=True)  # Local fixture certificate only.
    page = context.new_page()
    page.goto(base + '/login')
    # Tests bypass the public-address rule only for this loopback fixture.
    def local_fixture(value):
        return urlsplit(value).hostname in {'127.0.0.1', 'localhost'}
    downloads = directory / 'downloads'
    downloads.mkdir()
    with patch.object(guest_browser, 'PRIVATE', directory), patch.object(guest_browser, 'DOWNLOADS', downloads), patch.object(guest_browser, 'public_url', side_effect=local_fixture):
        guest_browser.operate({'operation': 'login', 'origin': 'https://127.0.0.1', 'username': USERNAME, 'password': PASSWORD}, browser)
        try:
            guest_browser.operate({'operation': 'type', 'text': 'MUST-NOT-BE-TYPED'}, browser)
            raise AssertionError('Ordinary typing into a credential field was accepted')
        except guest_browser.PrivateLoginRequired:
            assert page.locator('#password').input_value() == PASSWORD
        png = (directory / 'screen.png').read_bytes()
        for selector in ['#username', '#password', '#echo', '#canvas', '#vector', 'iframe']:
            masked_pixels(page, png, selector)
        page.evaluate("value => changed.textContent = value.toUpperCase().split('').join('\\u200b')", USERNAME)
        guest_browser.operate({'operation': 'screen'}, browser)
        masked_pixels(page, (directory / 'screen.png').read_bytes(), '#changed')
        page.evaluate("document.querySelector('#shadow').attachShadow({mode:'closed'}).innerHTML='<p>Private rendered content</p>'")
        try:
            guest_browser.operate({'operation': 'screen'}, browser)
            raise AssertionError('Closed shadow content must block the private view')
        except guest_browser.PrivacyBlocked:
            pass
        page.goto(base.replace('127.0.0.1', 'localhost') + '/login')
        try:
            guest_browser.operate({'operation': 'login', 'origin': 'https://127.0.0.1', 'username': USERNAME, 'password': PASSWORD}, browser)
            raise AssertionError('Changed origin accepted credentials')
        except ValueError:
            assert page.locator('#username').input_value() == ''
            assert page.locator('#password').input_value() == ''
        page.goto(base + '/login')
        bounds = page.locator('#download').bounding_box()
        guest_browser.operate({'operation': 'click', 'x': bounds['x'] + 10, 'y': bounds['y'] + 5}, browser)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and not (downloads / 'fixture-download.txt').exists():
            page.wait_for_timeout(100)
        assert (downloads / 'fixture-download.txt').read_bytes() == b'fixture-only download\n'
    context.close()
    print('PASS: rendered masks, private typing guard, closed-shadow blocking, changed-origin rejection, and an actual browser download.')


def ui_checks(browser, base):
    from playwright.sync_api import expect
    context = browser.new_context()
    page = context.new_page()
    page.set_viewport_size({'width': 1366, 'height': 768})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base)
    page.get_by_role('heading', name='Chat with Halo').wait_for()
    page.evaluate('document.fonts.ready')
    assert page.title() == 'halo'
    assert page.evaluate("document.fonts.check('600 16px Outfit')")
    assert 'Outfit' in page.locator('body').evaluate('(el) => getComputedStyle(el).fontFamily')
    expect(page.locator('.brand-logo-dark')).to_be_visible()
    expect(page.locator('.brand-logo-light')).to_be_hidden()
    for asset in ['/fonts/outfit-variable.woff2', '/favicon.svg', '/favicon.ico', '/site.webmanifest', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png']:
        assert context.request.get(base + asset).status == 200, asset
    expect(page.locator('#desktop-sidebar')).to_be_hidden()
    page.get_by_role('button', name='Show virtual desktop', exact=True).click()
    for width, height in [(1280, 720), (1366, 768), (1440, 900)]:
        page.set_viewport_size({'width': width, 'height': height})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight'), f'Workspace overflow at {width}x{height}'
        assert page.locator('#messages').evaluate('(el) => el.scrollHeight <= el.clientHeight + 1'), f'Welcome content needs scrolling at {width}x{height}'
        preview = page.locator('#desktop').bounding_box()
        empty = page.locator('#empty-desktop').bounding_box()
        assert empty['x'] >= preview['x'] - 1 and empty['x'] + empty['width'] <= preview['x'] + preview['width'] + 1, 'Desktop empty-state content is clipped'
    page.set_viewport_size({'width': 1366, 'height': 768})
    page.get_by_role('button', name='Hide virtual desktop').click()
    expect(page.locator('#desktop-sidebar')).to_be_hidden()
    page.reload()
    page.get_by_role('button', name='Show virtual desktop').click()
    expect(page.locator('#desktop-sidebar')).to_be_visible()
    textbox = page.locator('#message')
    before = textbox.bounding_box()['height']
    textbox.fill('\n'.join('A longer message.' for _ in range(20)))
    assert before < textbox.bounding_box()['height'] <= 161
    textbox.fill('')
    assert textbox.bounding_box()['height'] < 40
    FixtureHandler.state['error'] = 'The connection to Holo4 was interrupted. Start scripts/serve.sh if needed.'
    expect(page.locator('.app-notice')).to_be_visible()
    page.get_by_role('button', name='Dismiss notice').click()
    expect(page.locator('.app-notice')).to_be_hidden()
    FixtureHandler.state['error'] = None
    page.screenshot(path=str(ROOT / 'artifacts/ui-offline-review.png'), animations='disabled')
    FixtureHandler.state['credential_request'] = {'id': 'fixture-login', 'origin': 'https://example.test', 'reason': 'Dummy login test'}
    expect(page.get_by_role('region', name='Private website login')).to_be_visible()
    page.get_by_label('Email or username').fill(USERNAME)
    page.get_by_label('Password', exact=True).fill(PASSWORD)
    page.get_by_role('button', name='Fill private fields').click()
    expect(page.get_by_role('region', name='Private website login')).to_be_hidden()
    assert len(FixtureHandler.posts) == 1 and FixtureHandler.posts[0][0] == '/api/login'
    assert USERNAME not in page.locator('#messages').inner_text()
    assert PASSWORD not in page.locator('#messages').inner_text()
    page.get_by_role('button', name='Switch to light mode').click()
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--raised').trim()") == '#f3f3f2'
    expect(page.locator('.brand-logo-dark')).to_be_visible()
    expect(page.locator('.brand-logo-light')).to_be_hidden()
    assert page.locator('.sidebar').evaluate('(el) => getComputedStyle(el).backgroundColor') == 'rgb(8, 8, 8)'
    page.screenshot(path=str(ROOT / 'artifacts/ui-halo-light.png'), animations='disabled')
    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(ROOT / 'artifacts/ui-offline-mobile.png'), full_page=True, animations='disabled')
    context.close()
    assert not errors, errors
    print('PASS: three laptop layouts, sidebar persistence, composer growth, notice dismissal, private form transport, light theme, and mobile width.')


def main():
    from playwright.sync_api import sync_playwright
    chrome = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    if not chrome.exists():
        raise SystemExit('Google Chrome is required for this optional local check. No browser is downloaded automatically.')
    with tempfile.TemporaryDirectory(prefix='holo-browser-check-') as temp:
        directory = Path(temp)
        cert, key = directory / 'cert.pem', directory / 'key.pem'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(key), '-out', str(cert), '-days', '1', '-subj', '/CN=localhost'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with fixture_server((cert, key)) as secure_site, fixture_server() as ui_site, sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=str(chrome), headless=True, args=['--disable-gpu'])
            try:
                private_browser_checks(browser, secure_site, directory)
                ui_checks(browser, ui_site)
            finally:
                browser.close()
    print('No model, VM, real credentials, or personal browser profile used.')


if __name__ == '__main__':
    main()
