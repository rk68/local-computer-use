"""Fixed guest-side browser harness. Invoked only inside the disposable online VM.

Requests and short-lived secrets live in a private tmpfs directory. No secret is
passed in command arguments or printed. Errors deliberately omit page contents.
"""
import ipaddress
import json
import os
import re
from pathlib import Path
import socket
import sys
import time
from urllib.parse import urlsplit

PRIVATE = Path('/dev/shm/holo-private')
DOWNLOADS = Path('/tmp/holo-downloads')
os.environ.pop('DEBUG', None)
os.environ['PWDEBUG'] = '0'


def public_url(value):
    try:
        url = urlsplit(value)
        if url.scheme != 'https' or not url.hostname or url.username or url.password or url.port not in (None, 443):
            return False
        addresses = socket.getaddrinfo(url.hostname, 443, type=socket.SOCK_STREAM)
        return bool(addresses) and all(ipaddress.ip_address(item[4][0]).is_global for item in addresses)
    except (ValueError, OSError):
        return False


def origin(value):
    url = urlsplit(value)
    return f'{url.scheme}://{url.hostname}'


class PrivacyBlocked(Exception):
    """A known rendering surface cannot be safely inspected by the model."""


def secret_matcher(value):
    # Match case changes and invisible/inter-character spacing without huge regexes.
    gap = r'[\s\u200b\u200c\u200d\ufeff]*'
    return re.compile(gap.join(re.escape(char) for char in value[:128]), re.IGNORECASE)


def contains_closed_shadow(node):
    if isinstance(node, dict):
        return node.get('shadowRootType') == 'closed' or any(contains_closed_shadow(value) for value in node.values())
    return isinstance(node, list) and any(contains_closed_shadow(value) for value in node)


def prepare_context(browser):
    # Keep a window alive while replacing the initial browser context.
    old_pages = [page for context in browser.contexts for page in context.pages]
    context = browser.new_context(accept_downloads=True, service_workers='block', viewport={'width': 1280, 'height': 800})
    context.route_web_socket('**/*', lambda connection: connection.close())
    context.new_page()
    for page in old_pages:
        page.close()
    return context


def operate(request, browser):
    context = browser.contexts[-1]
    pages = [page for page in context.pages if not page.is_closed()]
    page = pages[-1] if pages else context.new_page()
    page.set_default_timeout(5000)
    page.set_viewport_size({'width': 1280, 'height': 800})
    cdp = context.new_cdp_session(page)
    try:
        target = cdp.send('Target.getTargetInfo')['targetInfo']
        options = {'behavior': 'allow', 'downloadPath': str(DOWNLOADS)}
        if isinstance(target.get('browserContextId'), str):
            options['browserContextId'] = target['browserContextId']
        cdp.send('Browser.setDownloadBehavior', options)
    finally:
        cdp.detach()
    # Public HTTPS only. This is application filtering, not a VM firewall.
    def route_request(route):
        try:
            if public_url(route.request.url):
                route.continue_()
            else:
                route.abort()
        except Exception:
            pass  # Do not log URLs or browser exceptions from credential-bearing pages.
    context.unroute('**/*')
    context.route('**/*', route_request)
    operation = request['operation']
    privacy_path = PRIVATE / 'privacy.json'
    secrets = json.loads(privacy_path.read_text()) if privacy_path.exists() else []
    if operation == 'navigate':
        if not public_url(request['url']):
            raise ValueError('Public HTTPS websites only.')
        page.goto(request['url'], wait_until='domcontentloaded', timeout=30000)
    elif operation == 'login':
        expected = request['origin']
        if not public_url(page.url) or origin(page.url) != expected:
            raise ValueError('The current page does not match the approved website.')
        password = page.locator('input[type=password]:visible')
        username = page.locator('input[type=email]:visible, input[autocomplete=username]:visible')
        if username.count() == 0:
            username = page.locator('input[type=text]:visible')
        if password.count() != 1 or username.count() != 1:
            raise ValueError('Login fields are ambiguous. No credentials were entered.')
        for value in (request['username'], request['password']):
            if value not in secrets:
                secrets.append(value)
        privacy_path.write_text(json.dumps(secrets))
        os.chmod(privacy_path, 0o600)
        if origin(page.url) != expected:
            raise ValueError('The page changed before login.')
        username.fill(request['username'])
        if origin(page.url) != expected:
            raise ValueError('The page changed during login.')
        password.fill(request['password'])
        # Fill only. The model can propose the visible sign-in button afterward.
    elif operation == 'click':
        page.mouse.click(request['x'], request['y'])
    elif operation == 'type':
        page.keyboard.insert_text(request['text'])
    elif operation == 'replace_text':
        page.mouse.click(request['x'], request['y'])
        page.keyboard.press('Control+a')
        page.keyboard.insert_text(request['text'])
    elif operation == 'key':
        key = request['key'].replace('ctrl', 'Control').replace('shift', 'Shift')
        names = {'enter': 'Enter', 'tab': 'Tab', 'escape': 'Escape', 'backspace': 'Backspace',
                 'delete': 'Delete', 'up': 'ArrowUp', 'down': 'ArrowDown', 'left': 'ArrowLeft', 'right': 'ArrowRight', 'space': 'Space'}
        page.keyboard.press('+'.join(names.get(part, part) for part in key.split('+')))
    elif operation == 'scroll':
        page.mouse.move(request['x'], request['y'])
        page.mouse.wheel(0, -450 if request['direction'] == 'up' else 450)
    elif operation != 'screen':
        raise ValueError('Unknown browser operation.')
    # Always hide editable values. Once used, hide known secret text and rendered media too.
    masks = [page.locator('input:not([type=button]):not([type=submit]), textarea, [contenteditable=true]')]
    if secrets:
        session = context.new_cdp_session(page)
        try:
            document = session.send('DOM.getDocument', {'depth': -1, 'pierce': True})
            if contains_closed_shadow(document):
                raise PrivacyBlocked
        finally:
            session.detach()
        masks.append(page.locator('canvas, img, video, iframe, svg, object, embed'))
        masks.extend(page.get_by_text(secret_matcher(value)) for value in secrets)
    png = page.screenshot(mask=masks, mask_color='#292929', timeout=10000)
    current = origin(page.url) if public_url(page.url) else None
    (PRIVATE / 'screen.png').write_bytes(png)
    os.chmod(PRIVATE / 'screen.png', 0o600)
    return {'ok': True, 'origin': current}


def run(request):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp('http://127.0.0.1:9222', timeout=10000)
        return operate(request, browser)


def failure(privacy=False):
    return {'ok': False, 'error_code': 'privacy-blocked' if privacy else 'operation-failed'}


def serve():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        browser = None
        for attempt in range(30):
            try:
                browser = playwright.chromium.connect_over_cdp('http://127.0.0.1:9222', timeout=1000)
                break
            except Exception:
                time.sleep(.5)
        if browser is None:
            return
        context = prepare_context(browser)
        ready = PRIVATE / 'request.ready'
        request_path = PRIVATE / 'request.json'
        while True:
            try:
                pages = context.pages
                page = pages[-1] if pages else context.new_page()
                page.wait_for_timeout(100)  # Keep Playwright's network routing active between actions.
            except Exception:
                return
            if not ready.exists():
                continue
            ready.unlink(missing_ok=True)
            request = {}
            try:
                request = json.loads(request_path.read_text())
                request_path.unlink(missing_ok=True)
                result = operate(request, browser)
            except PrivacyBlocked:
                result = failure(privacy=True)
            except Exception:
                result = failure()  # Never print Playwright exceptions containing values.
            result['request_id'] = request.get('request_id')
            result_path = PRIVATE / 'result.json'
            temporary = PRIVATE / 'result.tmp'
            temporary.write_text(json.dumps(result))
            os.chmod(temporary, 0o600)
            temporary.replace(result_path)


def client():
    result_path = PRIVATE / 'result.json'
    expected = json.loads((PRIVATE / 'request.json').read_text())['request_id']
    result_path.unlink(missing_ok=True)
    (PRIVATE / 'request.ready').touch(mode=0o600)
    deadline = time.monotonic() + 40
    try:
        while time.monotonic() < deadline:
            if result_path.exists():
                result = json.loads(result_path.read_text())
                result_path.unlink(missing_ok=True)
                if result.get('request_id') == expected:
                    return result
            time.sleep(.05)
        return failure()
    finally:
        (PRIVATE / 'request.json').unlink(missing_ok=True)
        (PRIVATE / 'request.ready').unlink(missing_ok=True)


if __name__ == '__main__':
    if '--serve' in sys.argv:
        try:
            serve()
        except Exception:
            pass
    else:
        try:
            print(json.dumps(client()))
        except Exception:
            print(json.dumps(failure()))
