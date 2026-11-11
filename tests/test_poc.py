"""Boundary and lifecycle tests use fake guests; they never control the host."""
import asyncio
from email.message import Message
import json
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from app import core
from app.server import Handler, HOST, PORT, ORIGIN, TOKEN


def fake_guest():
    return SimpleNamespace(
        id='local:holo-poc-1234abcd', destroy=AsyncMock(),
        get_dimensions=AsyncMock(return_value=(1280, 800)),
        screenshot=AsyncMock(return_value=b'\x89PNG\r\n\x1a\nimage'),
        mouse=SimpleNamespace(click=AsyncMock(), scroll=AsyncMock()),
        keyboard=SimpleNamespace(type=AsyncMock(), keypress=AsyncMock()),
        files=SimpleNamespace(write_text=AsyncMock()),
        shell=SimpleNamespace(run=AsyncMock(return_value=SimpleNamespace(success=True))),
    )


def model_action(action):
    return {'choices': [{'finish_reason': 'tool_calls', 'message': {
        'content': '', 'tool_calls': [{'function': {
            'name': 'desktop_action', 'arguments': json.dumps(action)}}]}}]}


def model_reply(text='Done.'):
    response = model_action({'text': text})
    response['choices'][0]['message']['tool_calls'][0]['function']['name'] = 'desktop_reply'
    return response


class ActionValidation(unittest.TestCase):
    def test_forbids_host_shell_and_unexpected_fields(self):
        for action in [
            {'action': 'shell', 'command': 'touch /tmp/bad', 'reason': 'test'},
            {'action': 'click', 'x': 2, 'y': 2, 'host': True, 'reason': 'test'},
            {'action': ['click'], 'reason': 'test'},
            {'action': 'type', 'text': 'hello\nrm -rf /', 'reason': 'test'},
            {'action': 'key', 'key': 'ctrl+alt+t', 'reason': 'test'},
            {'action': 'key', 'key': [], 'reason': 'test'},
            {'action': 'type', 'text': 'a' * 501, 'reason': 'test'},
        ]:
            with self.subTest(action=action), self.assertRaises(ValueError):
                core.validate_action(action, 1280, 800)

    def test_pixel_bounds_and_integer_coordinates(self):
        for x, y in [(-1, 0), (1280, 0), (0, 800), (True, 0), (.5, 0)]:
            with self.subTest(x=x, y=y), self.assertRaises(ValueError):
                core.validate_action({'action': 'click', 'x': x, 'y': y, 'reason': 'test'}, 1280, 800)


class GuestLifecycle(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.marker = Path(self.directory.name) / 'owned.json'
        self.patcher = patch.object(core, 'OWNED', self.marker)
        self.patcher.start()
        self.compat = patch('app.cua_compat.prepare')
        self.compat.start()
        self.logger = patch.object(core, 'LOGGER')
        self.logger.start()
        self.qemu = patch.object(core.shutil, 'which', return_value='/test/qemu')
        self.qemu.start()
        self.model = patch.object(core, 'model_request', return_value=model_reply())
        self.model.start()
        self.verifier = patch.object(core, 'verify_completion', new=AsyncMock(return_value='The requested changes are visible.'))
        self.verifier.start()
        self.desk = core.Desk()
        self.guest = fake_guest()
        self.desk.sb = self.guest
        self.desk.width, self.desk.height = 1280, 800
        self.action = {'action': 'click', 'x': 100, 'y': 200, 'reason': 'Focus name field.'}

    async def asyncTearDown(self):
        self.verifier.stop()
        self.model.stop()
        self.patcher.stop()
        self.compat.stop()
        self.logger.stop()
        self.qemu.stop()
        self.directory.cleanup()

    def pending(self, age=0):
        self.desk.pending = {'id': 'approval-123', 'action': self.action,
                             'epoch': self.desk.epoch, 'created': time.time() - age}

    async def test_manual_task_continues_to_second_action(self):
        with patch.object(core, 'model_request', side_effect=[
                model_action(self.action), model_action(self.action), model_reply()]):
            await self.desk.chat('Click twice', True)
            self.assertEqual(self.desk.actions, 0)
            await self.desk.approve(self.desk.pending['id'])
            self.assertEqual(self.desk.actions, 1)
            self.assertIsNotNone(self.desk.pending)
            await self.desk.approve(self.desk.pending['id'])
        self.assertEqual(self.desk.actions, 2)
        self.assertIsNone(self.desk.pending)
        self.assertIsNone(self.desk.desktop_task)
        self.assertEqual(sum(m['role'] == 'user' for m in self.desk.messages), 1)

    async def test_automatic_task_executes_each_validated_step(self):
        self.desk.set_approval_mode(True)
        with patch.object(core, 'model_request', side_effect=[
                model_action(self.action), model_action(self.action), model_reply()]):
            await self.desk.chat('Click twice', True)
        self.assertEqual(self.desk.actions, 2)
        self.assertIsNone(self.desk.pending)
        self.assertIsNone(self.desk.desktop_task)
        self.assertEqual(self.guest.mouse.click.await_count, 2)

    async def test_automatic_mode_still_rejects_invalid_actions(self):
        self.desk.set_approval_mode(True)
        response = model_action({'action': 'shell', 'command': 'bad', 'reason': 'test'})
        with patch.object(core, 'model_request', return_value=response), self.assertRaises(ValueError):
            await self.desk.chat('Click twice', True)
        self.assertEqual(self.desk.actions, 0)
        self.guest.mouse.click.assert_not_awaited()

    async def test_unchecking_during_inference_pauses_before_execution(self):
        self.desk.set_approval_mode(True)
        def response(*_):
            self.desk.set_approval_mode(False)
            return model_action(self.action)
        with patch.object(core, 'model_request', side_effect=response):
            await self.desk.chat('Click name', True)
        self.assertIsNotNone(self.desk.pending)
        self.guest.mouse.click.assert_not_awaited()

    async def test_stop_resets_automatic_approval_and_task(self):
        self.desk.set_approval_mode(True)
        with patch.object(core, 'model_request', return_value=model_action(self.action)):
            self.desk.set_approval_mode(False)
            await self.desk.chat('Click name', True)
        self.desk.set_approval_mode(True)
        await self.desk.stop()
        self.assertFalse(self.desk.approve_all)
        self.assertIsNone(self.desk.desktop_task)
        self.assertIsNone(self.desk.pending)

    async def test_proposal_cannot_execute_without_approval(self):
        with patch.object(core, 'model_request', return_value=model_action(self.action)):
            await self.desk.chat('Click the name field', True)
        self.assertIsNotNone(self.desk.pending)
        self.guest.mouse.click.assert_not_awaited()

    async def test_textual_holo_proposal_uses_the_approval_flow(self):
        reply = '{"action":{"type":"desktop_action","action":"click","x":500,"y":500}}'
        response = {'choices': [{'finish_reason': 'stop', 'message': {'content': reply}}]}
        with patch.object(core, 'model_request', return_value=response):
            await self.desk.chat('Click the name field', True)
        self.assertEqual(self.desk.pending['action']['x'], 640)
        self.assertNotIn(reply, self.desk.messages[-1]['text'])
        self.guest.mouse.click.assert_not_awaited()
        await self.desk.approve(self.desk.pending['id'])
        self.guest.mouse.click.assert_awaited_once_with(640, 400)

    async def test_native_proposal_scales_coordinates_before_approval(self):
        response = model_action({'x': 414, 'y': 628, 'reason': 'Focus the name field.'})
        response['choices'][0]['message']['tool_calls'][0]['function']['name'] = 'desktop_click'
        with patch.object(core, 'model_request', return_value=response):
            await self.desk.chat('Click the name field', True)
        action = self.desk.pending['action']
        self.assertEqual((action['x'], action['y']), (529, 502))
        self.guest.mouse.click.assert_not_awaited()

    async def test_textual_proposal_in_chat_mode_gets_mode_guidance(self):
        reply = '{"action":{"type":"desktop_action","action":"click","x":500,"y":500}}'
        response = {'choices': [{'finish_reason': 'stop', 'message': {'content': reply}}]}
        with patch.object(core, 'model_request', return_value=response):
            await self.desk.chat('Click the name field', False)
        self.assertIn('Include sandbox screenshot', self.desk.messages[-1]['text'])
        self.assertIsNone(self.desk.pending)
        self.guest.mouse.click.assert_not_awaited()

    async def test_google_request_explains_offline_guest(self):
        with patch.object(core, 'model_request') as model:
            await self.desk.chat('go to google.com and search for youtube', True)
        model.assert_not_called()
        self.assertIn('internet access turned off', self.desk.messages[-1]['text'])
        self.assertIsNone(self.desk.pending)

    async def test_edit_requests_in_chat_mode_cannot_claim_completion(self):
        with patch.object(core, 'model_request') as model:
            await self.desk.chat('Change the name to Alice', False)
        model.assert_not_called()
        self.assertIn('enable', self.desk.messages[-1]['text'])
        self.assertIsNone(self.desk.pending)

    async def test_false_completion_reply_for_field_edit_is_suppressed(self):
        response = model_action({'text': 'The name has been changed to Alice.'})
        response['choices'][0]['message']['tool_calls'][0]['function']['name'] = 'desktop_reply'
        with patch.object(core, 'model_request', return_value=response):
            await self.desk.chat("Delete the name 'Alex' and change it to 'Alice'", True)
        self.assertIn('was not changed', self.desk.messages[-1]['text'])
        self.assertIsNone(self.desk.pending)
        self.guest.keyboard.type.assert_not_awaited()

    async def test_one_approval_executes_once_in_guest(self):
        self.pending()
        await self.desk.approve('approval-123')
        self.guest.mouse.click.assert_awaited_once_with(100, 200)
        with self.assertRaises(ValueError):
            await self.desk.approve('approval-123')
        self.assertEqual(self.desk.actions, 1)
        self.assertNotIn('"x"', self.desk.desktop_history[-1])
        self.assertNotIn('"y"', self.desk.desktop_history[-1])

    async def test_forged_approval_does_not_consume_real_proposal(self):
        self.pending()
        with self.assertRaises(ValueError):
            await self.desk.approve('forged')
        self.assertIsNotNone(self.desk.pending)
        self.guest.mouse.click.assert_not_awaited()

    async def test_expired_approval_never_executes(self):
        self.pending(age=121)
        with self.assertRaises(ValueError):
            await self.desk.approve('approval-123')
        self.guest.mouse.click.assert_not_awaited()

    async def test_stop_clears_approval_and_destroys_only_owned_guest(self):
        self.pending()
        self.marker.write_text('{"name":"holo-poc-1234abcd"}')
        await self.desk.stop()
        self.guest.destroy.assert_awaited_once()
        self.assertIsNone(self.desk.pending)
        self.assertIsNone(self.desk.sb)
        self.assertFalse(self.marker.exists())
        with self.assertRaises(ValueError):
            await self.desk.approve('approval-123')

    async def test_late_model_response_after_stop_is_discarded(self):
        task = asyncio.create_task(self.desk.chat('Click name', True))
        def late_response(*_):
            self.desk.epoch += 1
            return model_action(self.action)
        with patch.object(core, 'model_request', side_effect=late_response):
            await task
        self.assertIsNone(self.desk.pending)
        self.guest.mouse.click.assert_not_awaited()

    async def test_action_limit_cannot_be_bypassed(self):
        self.pending()
        self.desk.actions = core.MAX_ACTIONS
        with self.assertRaises(ValueError):
            await self.desk.approve('approval-123')
        self.guest.mouse.click.assert_not_awaited()

    async def test_failed_cleanup_retains_handle_for_retry(self):
        self.guest.destroy.side_effect = RuntimeError('backend unavailable')
        await self.desk.stop()
        self.assertIs(self.desk.sb, self.guest)
        self.assertEqual(self.desk.phase, 'cleanup required')
        self.guest.destroy.side_effect = None
        await self.desk.stop()
        self.assertIsNone(self.desk.sb)

    async def test_chat_does_not_capture_guest_or_offer_tools(self):
        response = {'choices': [{'finish_reason': 'stop', 'message': {'content': 'Hello!'}}]}
        with patch.object(core, 'model_request', return_value=response) as model:
            await self.desk.chat('Hello', False)
        self.guest.screenshot.assert_not_awaited()
        self.assertNotIn('tools', model.call_args.args[1])

    async def test_two_tool_calls_are_rejected(self):
        response = model_action(self.action)
        response['choices'][0]['message']['tool_calls'] *= 2
        with patch.object(core, 'model_request', return_value=response):
            with self.assertRaises(ValueError):
                await self.desk.chat('Do two clicks', True)
        self.assertIsNone(self.desk.pending)

    async def test_online_mode_requires_explicit_start_preference(self):
        self.desk.sb = None
        browser = SimpleNamespace(prepare=AsyncMock(), call=AsyncMock(return_value=b'\x89PNG\r\n\x1a\nimage'), origin=None)
        sdk = SimpleNamespace(Image=SimpleNamespace(from_registry=lambda reference: reference),
                              Sandbox=SimpleNamespace(create=AsyncMock(return_value=self.guest)))
        with patch.dict('sys.modules', {'cua_sandbox': sdk}), patch.object(core, 'require_gateway'), patch.object(core, 'BrowserSession', return_value=browser), patch.object(core.asyncio, 'sleep', new=AsyncMock()):
            await self.desk.start(network=True)
        self.assertEqual(sdk.Sandbox.create.call_args.kwargs['network'], 'default')
        self.assertTrue(self.desk.network)
        browser.prepare.assert_awaited_once()
        self.guest.shell.run.assert_not_awaited()

    async def test_unverified_completion_is_not_reported_as_success(self):
        self.desk.set_approval_mode(True)
        with patch.object(core, 'model_request', side_effect=[model_action(self.action), model_reply('All done')]), patch.object(core, 'verify_completion', new=AsyncMock(side_effect=RuntimeError('Not all requested changes are visible'))):
            with self.assertRaisesRegex(RuntimeError, 'Not all requested'):
                await self.desk.chat('Click name', True)
        self.assertNotIn('All done', str(self.desk.messages))

    async def test_free_text_completion_cannot_skip_verification(self):
        self.desk.set_approval_mode(True)
        response = {'choices': [{'message': {'content': 'All done'}}]}
        with patch.object(core, 'model_request', side_effect=[model_action(self.action), response]), patch.object(core, 'verify_completion', new=AsyncMock(side_effect=RuntimeError('Result is missing'))):
            with self.assertRaisesRegex(RuntimeError, 'Result is missing'):
                await self.desk.chat('Click name', True)
        self.assertNotIn('All done', str(self.desk.messages))

    async def test_completion_only_exposes_filenames_already_named_by_user(self):
        self.desk.browser = SimpleNamespace(origin='https://example.com', call=AsyncMock(return_value=b'\x89PNG\r\n\x1a\nimage'))
        self.guest.files.list = AsyncMock(return_value=[
            SimpleNamespace(name='sample.csv', is_dir=False),
            SimpleNamespace(name='private-address@example.test.txt', is_dir=False),
            SimpleNamespace(name='unfinished.crdownload', is_dir=False)])
        self.desk.desktop_task = core.DesktopTask('Download sample.csv', self.desk.epoch, steps=1)
        with patch.object(core, 'verify_completion', new=AsyncMock(return_value='Requested file exists.')) as verify:
            await self.desk.finish_desktop_reply('Download sample.csv', 'Done', True, self.desk.epoch)
        observations = verify.call_args.args[3]
        self.assertEqual(observations['requested_files_present'], ['sample.csv'])
        self.assertEqual(observations['completed_download_count'], 2)
        self.assertNotIn('private-address', str(observations))

    async def test_opening_login_page_does_not_open_private_form(self):
        self.desk.network = True
        self.desk.browser = SimpleNamespace(origin='https://example.com', call=AsyncMock(return_value=b'\x89PNG\r\n\x1a\nimage'))
        self.desk.desktop_task = core.DesktopTask('Open https://example.com/login', self.desk.epoch, steps=1)
        response = model_action({'reason': 'Login page visible'})
        response['choices'][0]['message']['tool_calls'][0]['function']['name'] = 'desktop_request_login'
        with patch.object(core, 'model_request', return_value=response):
            await self.desk.chat('Open https://example.com/login', True, task_step=True)
        self.assertIsNone(self.desk.credential_request)
        core.verify_completion.assert_awaited_once()

    async def test_create_enforces_local_vm_no_network_and_no_mounts(self):
        self.desk.sb = None
        sdk = SimpleNamespace(
            Image=SimpleNamespace(from_registry=lambda reference: reference),
            Sandbox=SimpleNamespace(create=AsyncMock(return_value=self.guest)),
        )
        with patch.dict('sys.modules', {'cua_sandbox': sdk}), patch.object(core.asyncio, 'sleep', new=AsyncMock()):
            await self.desk.start()
        kwargs = sdk.Sandbox.create.call_args.kwargs
        self.assertEqual(kwargs['on'], 'local')
        self.assertIs(kwargs['local'], True)
        self.assertEqual(kwargs['kind'], 'vm')
        self.assertEqual(kwargs['runtime'], 'qemu')
        self.assertEqual(kwargs['network'], 'none')
        self.assertEqual(kwargs['memory_mb'], core.GUEST_MEMORY_MB)
        self.assertNotIn('mounts', kwargs)
        self.assertIs(kwargs['telemetry_enabled'], False)
        self.assertTrue(self.marker.exists())
        self.guest.shell.run.assert_awaited_once()

    async def test_recovery_refuses_an_unrelated_guest(self):
        self.desk.sb = None
        self.marker.write_text('{"name":"personal-macos"}')
        sdk = SimpleNamespace(Sandbox=SimpleNamespace(delete=AsyncMock()))
        with patch.dict('sys.modules', {'cua_sandbox': sdk}):
            await self.desk.stop()
        sdk.Sandbox.delete.assert_not_awaited()
        self.assertEqual(self.desk.phase, 'cleanup required')

    async def test_invalid_model_action_never_becomes_approvable(self):
        for action in [dict(self.action, x=4000), {'action': 'shell', 'reason': 'x', 'command': 'whoami'}]:
            with patch.object(core, 'model_request', return_value=model_action(action)):
                with self.assertRaises(ValueError):
                    await self.desk.chat('Do something', True)
            self.assertIsNone(self.desk.pending)


class BrowserBoundary(unittest.TestCase):
    def handler(self, host=f'{HOST}:{PORT}', origin=ORIGIN, token=TOKEN, fetch_site='same-origin'):
        handler = object.__new__(Handler)
        handler.headers = Message()
        for name, value in [('Host', host), ('Origin', origin), ('X-Local-Token', token), ('Sec-Fetch-Site', fetch_site)]:
            handler.headers[name] = value
        handler.responses = []
        handler.respond = lambda *args: handler.responses.append(args)
        return handler

    def test_rejects_remote_origin_rebinding_and_missing_token(self):
        for overrides in [{'host': 'attacker.test:8765'}, {'origin': 'https://attacker.test'},
                          {'origin': 'null'}, {'token': ''}, {'fetch_site': 'cross-site'}]:
            with self.subTest(overrides=overrides):
                handler = self.handler(**overrides)
                self.assertFalse(handler.trusted(api=True))
                self.assertEqual(handler.responses[0][0], 403)

    def test_allows_same_origin_token_request(self):
        self.assertTrue(self.handler().trusted(api=True))


if __name__ == '__main__':
    unittest.main()
