"""Regression checks for real delta delivery and incomplete reply handling."""
from types import SimpleNamespace
import json
import unittest
from unittest.mock import Mock, patch

from app.core import Desk
from app.model_stream import StreamCancelled, TextGeneration


def frames(*events):
    result = []
    for event in events:
        data = event if isinstance(event, str) else json.dumps(event)
        result.extend([f'data: {data}\n'.encode(), b'\n'])
    return result


def delta(text, finish=None):
    return {'choices': [{'delta': {'content': text}, 'finish_reason': finish}]}


class Response:
    status = 200

    def __init__(self, events):
        self.events = events
        self.finished = False

    def getheader(self, name, default=None):
        return 'text/event-stream'

    def __iter__(self):
        for line in self.events:
            yield line
        self.finished = True

    def close(self):
        pass


def connection(response):
    return SimpleNamespace(connect=Mock(), request=Mock(), getresponse=Mock(return_value=response),
                           close=Mock(), sock=SimpleNamespace(shutdown=Mock()))


class ModelStreaming(unittest.TestCase):
    def test_deltas_arrive_before_upstream_finishes(self):
        response = Response(frames(delta('Hello'), delta(' world'), delta('', 'stop'), '[DONE]'))
        received = []
        def collect(text):
            self.assertFalse(response.finished)
            received.append(text)
        with patch('app.model_stream.http.client.HTTPConnection', return_value=connection(response)):
            answer = TextGeneration().generate({}, collect)
        self.assertEqual(received, ['Hello', ' world'])
        self.assertEqual(answer, 'Hello world')

    def test_disconnect_and_token_limit_reject_partial_answers(self):
        for events in [frames(delta('Partial')), frames(delta('Partial'), delta('', 'length'), '[DONE]')]:
            with self.subTest(events=events):
                with patch('app.model_stream.http.client.HTTPConnection', return_value=connection(Response(events))):
                    with self.assertRaises(RuntimeError):
                        TextGeneration().generate({}, lambda _: None)

    def test_cancel_interrupts_the_connection(self):
        response = Response(frames(delta('Hello'), delta(' world'), delta('', 'stop'), '[DONE]'))
        conn = connection(response)
        generation = TextGeneration('my-request')
        with patch('app.model_stream.http.client.HTTPConnection', return_value=conn):
            with self.assertRaises(StreamCancelled):
                generation.generate({}, lambda _: generation.cancel())
        conn.sock.shutdown.assert_called_once()


class StreamingMemory(unittest.IsolatedAsyncioTestCase):
    async def test_only_a_complete_reply_reaches_saved_memory(self):
        for finish in ['length', 'stop']:
            memory = SimpleNamespace(read=lambda: [], append=Mock())
            desk = Desk(memory=memory)
            response = Response(frames(delta('Answer'), delta('', finish), '[DONE]'))
            with patch('app.model_stream.http.client.HTTPConnection', return_value=connection(response)):
                if finish == 'stop':
                    await desk.chat('A question', False, on_delta=lambda _: None)
                    memory.append.assert_called_once_with('A question', 'Answer')
                else:
                    with self.assertRaises(RuntimeError):
                        await desk.chat('A question', False, on_delta=lambda _: None)
                    memory.append.assert_not_called()


if __name__ == '__main__':
    unittest.main()
