"""Network and credential boundaries. No VM, real browser, model, or Keychain writes."""
import asyncio
import json
from pathlib import Path
import tempfile
import traceback
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app import core, guest_browser
from app.browser_session import BrowserSession
from app.credential_vault import CredentialVault, website_origin
from app.desktop_task import DesktopTask
from app.task_verification import verify_completion

PNG = b'\x89PNG\r\n\x1a\nmasked'


class Vault(unittest.TestCase):
    def test_origin_scope_and_scheme_validation(self):
        self.assertEqual(website_origin('https://EXAMPLE.com/login?q=1'), 'https://example.com')
        for bad in ['http://example.com', 'https://user:pass@example.com', 'https://example.com:8443', 'file:///tmp/test', None]:
            with self.subTest(value=bad), self.assertRaises(ValueError):
                website_origin(bad)

    def test_credentials_only_use_selected_keychain_backend(self):
        backend = MagicMock()
        vault = CredentialVault(backend)
        vault.save('https://example.com/login', 'private@example.com', 'secret-password')
        service, origin, value = backend.set_password.call_args.args
        self.assertEqual(origin, 'https://example.com')
        self.assertEqual(json.loads(value)['password'], 'secret-password')
        backend.get_password.return_value = value
        self.assertEqual(vault.read(origin)['username'], 'private@example.com')
        vault.delete(origin)
        backend.delete_password.assert_called_once_with(service, origin)

    def test_backend_errors_cannot_echo_passwords(self):
        backend = MagicMock()
        backend.set_password.side_effect = RuntimeError('secret-password')
        with self.assertRaises(ValueError) as raised:
            CredentialVault(backend).save('https://example.com', 'name', 'secret-password')
        rendered = ''.join(traceback.format_exception(raised.exception))
        self.assertNotIn('secret-password', rendered)


class BrowserBoundary(unittest.TestCase):
    def test_private_addresses_and_non_https_are_rejected(self):
        for address in ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1']:
            with patch.object(guest_browser.socket, 'getaddrinfo', return_value=[(0, 0, 0, '', (address, 443))]):
                self.assertFalse(guest_browser.public_url('https://example.com'))
        for url in ['http://example.com', 'file:///tmp/key', 'https://user:pass@example.com']:
            self.assertFalse(guest_browser.public_url(url))
        with patch.object(guest_browser.socket, 'getaddrinfo', return_value=[(0, 0, 0, '', ('93.184.216.34', 443))]):
            self.assertTrue(guest_browser.public_url('https://example.com'))

    def test_login_masks_fields_secret_text_and_media(self):
        with tempfile.TemporaryDirectory() as directory:
            page = MagicMock()
            page.url = 'https://example.com/login'
            page.is_closed.return_value = False
            password, username = MagicMock(), MagicMock()
            password.count.return_value = username.count.return_value = 1
            page.locator.side_effect = lambda selector: password if selector == 'input[type=password]:visible' else username if selector.startswith('input[type=email]:visible') else MagicMock()
            page.screenshot.return_value = PNG
            context = MagicMock(pages=[page])
            playwright = MagicMock()
            playwright.chromium.connect_over_cdp.return_value.contexts = [context]
            manager = MagicMock()
            manager.__enter__.return_value = playwright
            module = SimpleNamespace(sync_playwright=lambda: manager)
            with patch.dict('sys.modules', {'playwright.sync_api': module}), patch.object(guest_browser, 'PRIVATE', Path(directory)), patch.object(guest_browser, 'public_url', return_value=True):
                result = guest_browser.run({'operation': 'login', 'origin': 'https://example.com', 'username': 'secret-email', 'password': 'secret-password'})
            username.fill.assert_called_once_with('secret-email')
            password.fill.assert_called_once_with('secret-password')
            self.assertEqual(result, {'ok': True, 'origin': 'https://example.com'})
            self.assertNotIn('secret-email', json.dumps(result))
            page.get_by_text.assert_any_call('secret-password', exact=False)
            page.get_by_text.assert_any_call('secret-email', exact=False)
            self.assertEqual(len(page.screenshot.call_args.kwargs['mask']), 4)
            self.assertEqual((Path(directory) / 'privacy.json').stat().st_mode & 0o777, 0o600)


class BrowserBroker(unittest.IsolatedAsyncioTestCase):
    async def test_guest_errors_do_not_leak_secrets(self):
        guest = SimpleNamespace(files=SimpleNamespace(write_text=AsyncMock(side_effect=RuntimeError('private-password')), remove=AsyncMock()))
        with self.assertRaises(RuntimeError) as raised:
            await BrowserSession(guest).call('login', username='private-user', password='private-password')
        self.assertNotIn('private-password', ''.join(traceback.format_exception(raised.exception)))
        guest.files.remove.assert_awaited_once()

    async def test_only_fixed_helper_command_is_executed(self):
        guest = SimpleNamespace(files=SimpleNamespace(write_text=AsyncMock(), read_bytes=AsyncMock(return_value=PNG), remove=AsyncMock()), shell=SimpleNamespace(run=AsyncMock(return_value=SimpleNamespace(success=True, stdout='{"ok":true,"origin":"https://example.com","request_id":"fixed-request"}'))))
        broker = BrowserSession(guest)
        with patch('app.browser_session.secrets.token_hex', return_value='fixed-request'):
            await broker.call('login', password='private-password')
        command = guest.shell.run.call_args.args[0]
        self.assertEqual(command, '/tmp/holo-browser-env/bin/python /tmp/holo-browser.py')
        self.assertNotIn('private-password', command)

    async def test_stale_browser_response_is_not_reused(self):
        guest = SimpleNamespace(files=SimpleNamespace(write_text=AsyncMock(), read_bytes=AsyncMock(return_value=PNG), remove=AsyncMock()), shell=SimpleNamespace(run=AsyncMock(return_value=SimpleNamespace(success=True, stdout='{"ok":true,"origin":"https://example.com","request_id":"old-request"}'))))
        with self.assertRaises(RuntimeError):
            await BrowserSession(guest).call('screen')
        guest.files.read_bytes.assert_not_awaited()

    async def test_login_rejects_changed_origin_before_releasing_secrets(self):
        desk = core.Desk()
        desk.browser = SimpleNamespace(origin='https://other.com', call=AsyncMock())
        desk.credential_request = {'id': 'request', 'origin': 'https://example.com', 'epoch': desk.epoch}
        desk.vault = MagicMock()
        with self.assertRaisesRegex(ValueError, 'website changed'):
            await desk.login({'id': 'request', 'username': 'private-user', 'password': 'private-password', 'remember': True})
        desk.browser.call.assert_awaited_once_with('screen')
        desk.vault.save.assert_not_called()

    async def test_login_does_not_enter_secrets_into_chat_or_snapshot(self):
        desk = core.Desk()
        desk.sb = SimpleNamespace(id='fake')
        desk.browser = SimpleNamespace(origin='https://example.com', call=AsyncMock())
        desk.credential_request = {'id': 'request', 'origin': 'https://example.com', 'epoch': desk.epoch}
        await desk.login({'id': 'request', 'username': 'private-user', 'password': 'private-password'})
        state = json.dumps(desk.snapshot())
        self.assertNotIn('private-user', state)
        self.assertNotIn('private-password', state)
        self.assertIsNone(desk.credential_request)

    async def test_private_login_never_enters_model_request_payloads(self):
        desk = core.Desk()
        desk.sb = SimpleNamespace(id='fake')
        desk.browser = SimpleNamespace(origin='https://example.com', call=AsyncMock(return_value=PNG))
        def reply(name, arguments):
            return {'choices': [{'message': {'tool_calls': [{'function': {'name': name, 'arguments': json.dumps(arguments)}}]}}]}
        responses = [reply('desktop_request_login', {'reason': 'The website asks for a login.'}), reply('desktop_reply', {'text': 'Done'})]
        with patch.object(core, 'model_request', side_effect=responses) as model, patch.object(core, 'verify_completion', new=AsyncMock(return_value='Signed-in page visible.')):
            await desk.chat('Sign in to the current website', True)
            await desk.login({'id': desk.credential_request['id'], 'username': 'private-user', 'password': 'private-password'})
        payloads = str(model.call_args_list)
        self.assertNotIn('private-user', payloads)
        self.assertNotIn('private-password', payloads)
        self.assertEqual(desk.actions, 1)
        self.assertIsNone(desk.desktop_task)

    async def test_stale_login_request_cannot_release_secrets(self):
        desk = core.Desk()
        desk.browser = SimpleNamespace(origin='https://example.com', call=AsyncMock())
        desk.credential_request = {'id': 'request', 'origin': 'https://example.com', 'epoch': desk.epoch - 1}
        with self.assertRaises(ValueError):
            await desk.login({'id': 'request', 'password': 'private-password'})
        desk.browser.call.assert_not_awaited()


class Completion(unittest.IsolatedAsyncioTestCase):
    async def test_completion_requires_independent_visible_evidence(self):
        response = {'choices': [{'message': {'content': json.dumps({'verified': True, 'evidence': 'Saved: Alice is visible.'})}}]}
        request = MagicMock(return_value=response)
        evidence = await verify_completion(request, 'Set name to Alice', 'image-data')
        self.assertEqual(evidence, 'Saved: Alice is visible.')
        self.assertEqual(request.call_args.args[1]['messages'][-1]['content'][1]['image_url']['url'], 'image-data')

    async def test_missing_or_uncertain_results_pause_task(self):
        for result in [{'verified': False, 'evidence': 'Note is missing.'}, {'verified': 'true', 'evidence': 'bad'}, {'verified': True, 'evidence': ''}]:
            response = {'choices': [{'message': {'content': json.dumps(result)}}]}
            with self.subTest(result=result), self.assertRaises(RuntimeError):
                await verify_completion(MagicMock(return_value=response), 'Two changes', 'image-data')

    async def test_repeated_actions_are_bounded(self):
        task = DesktopTask('Click a field', 1)
        task.record('same')
        task.record('same')
        with self.assertRaisesRegex(ValueError, 'repeated three times'):
            task.record('same')
