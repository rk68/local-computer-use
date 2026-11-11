"""Thread boundaries use fake guests and temporary files. No model or VM starts."""
import asyncio
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch
from app import core, server
from test_poc import fake_guest


class SeparateDesktops(unittest.IsolatedAsyncioTestCase):
    async def test_two_guests_have_independent_ownership_and_stop(self):
        with tempfile.TemporaryDirectory() as directory:
            first = core.Desk(owned=Path(directory) / 'a.json')
            second = core.Desk(owned=Path(directory) / 'b.json')
            a, b = fake_guest(), fake_guest()
            b.id = 'local:holo-poc-abcd1234'
            sdk = SimpleNamespace(Image=SimpleNamespace(from_registry=lambda value: value), Sandbox=SimpleNamespace(create=AsyncMock(side_effect=[a, b])))
            with patch.dict('sys.modules', {'cua_sandbox': sdk}), patch('app.cua_compat.prepare'), patch.object(core.shutil, 'which', return_value='/fixture/qemu'), patch.object(core.asyncio, 'sleep', new=AsyncMock()), patch.object(core, 'LOGGER'):
                await first.start()
                await second.start()
                self.assertNotEqual(first.sb.id, second.sb.id)
                self.assertTrue(first.owned.exists())
                self.assertTrue(second.owned.exists())
                second.pending = {'id': 'second-approval', 'epoch': second.epoch}
                second.approve_all = True
                await first.stop()
                a.destroy.assert_awaited_once()
                b.destroy.assert_not_awaited()
                self.assertTrue(second.owned.exists())
                self.assertIsNotNone(second.pending)
                self.assertTrue(second.approve_all)
                await second.stop()


class ThreadRouting(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.env = patch.dict('os.environ', {'HOLO_CHAT_DB': str(Path(self.directory.name) / 'legacy.sqlite3')})
        self.env.start()
        self.marker = patch.object(server, 'OWNED', Path(self.directory.name) / 'owned.json')
        self.marker.start()
        self.logger = patch.object(core, 'LOGGER')
        self.logger.start()
        self.runtime = server.Runtime()
        # The default legacy desk must also use the temporary ownership location.
        self.runtime.desk.owned = Path(self.directory.name) / 'owned.json'
        self.a, self.b = 'a' * 32, 'b' * 32

    def tearDown(self):
        self.runtime.close()
        self.logger.stop(); self.marker.stop(); self.env.stop(); self.directory.cleanup()

    def call(self, path, body, thread):
        return self.runtime.call(self.runtime.dispatch(path, body, thread))

    def test_context_history_and_approvals_never_cross_threads(self):
        self.call('/api/thread-context', {'messages': [{'role': 'user', 'text': 'Private thread A'}], 'instructions': 'Bot A'}, self.a)
        self.call('/api/thread-context', {'messages': [{'role': 'assistant', 'text': 'Thread B reply'}], 'instructions': 'Bot B'}, self.b)
        self.assertEqual(self.call('/api/state', {}, self.a)['messages'][0]['text'], 'Private thread A')
        self.assertEqual(self.call('/api/state', {}, self.b)['messages'][0]['text'], 'Thread B reply')
        a, b = self.runtime.desks[self.a], self.runtime.desks[self.b]
        self.assertNotEqual(a.owned, b.owned)
        self.assertEqual(a.instructions, 'Bot A')
        self.assertEqual(b.instructions, 'Bot B')
        b.pending = {'id': 'only-b', 'epoch': 0}
        # Operation is launched but fails before touching another thread's pending approval.
        self.call('/api/approve', {'id': 'only-b'}, self.a)
        self.runtime.call(asyncio.sleep(.01))
        self.assertEqual(b.pending['id'], 'only-b')
        self.assertIn('missing', a.error)

    def test_ids_cannot_select_host_paths(self):
        for bad in ['../../personal', '', '/tmp/guest.json', 'abc', 'default/../a', None]:
            with self.subTest(value=bad), self.assertRaises(ValueError):
                self.call('/api/state', {}, bad)

    def test_recorded_guest_requires_cleanup_after_executor_restart(self):
        marker = Path(self.directory.name) / 'threads' / (self.a + '.json')
        marker.parent.mkdir()
        marker.write_text(json.dumps({'name': 'holo-poc-1234abcd'}))
        try:
            state = self.call('/api/state', {}, self.a)
            self.assertEqual(state['phase'], 'cleanup required')
            self.assertFalse(state['sandbox'])
            self.assertEqual(self.call('/api/state', {}, self.b)['phase'], 'idle')
            with self.assertRaisesRegex(ValueError, 'Cleanup'):
                self.call('/api/start', {}, self.a)
        finally:
            marker.unlink()

    def test_thread_context_rejects_untrusted_shape_before_mutation(self):
        for bad in [{'messages': [{'role': 'tool', 'text': 'bad'}]}, {'instructions': []}, {'messages': 'bad'}]:
            with self.assertRaises(ValueError):
                self.call('/api/thread-context', bad, self.a)
        self.assertEqual(self.call('/api/state', {}, self.a)['messages'], [])


if __name__ == '__main__':
    unittest.main()
