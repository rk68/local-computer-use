"""Incremental text inference against the fixed local llama.cpp endpoint."""
import http.client
import json
import socket
import threading


class StreamCancelled(Exception):
    pass


class TextGeneration:
    def __init__(self, request_id=None):
        self.request_id = request_id
        self.cancelled = threading.Event()
        self.connection = None
        self.socket = None

    def cancel(self):
        self.cancelled.set()
        # Interrupt a blocked read so a stopped generation releases the model
        # slot promptly even if llama.cpp is still processing the prompt.
        connection_socket = self.socket
        if connection_socket is not None:
            try:
                connection_socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def generate(self, payload, on_delta):
        pieces = []
        finish_reason = None
        complete = False
        response = None
        connection = http.client.HTTPConnection('127.0.0.1', 8080, timeout=45)
        self.connection = connection
        try:
            if self.cancelled.is_set():
                raise StreamCancelled()
            connection.connect()
            self.socket = connection.sock
            if self.cancelled.is_set():
                raise StreamCancelled()
            connection.request('POST', '/v1/chat/completions',
                               body=json.dumps({**payload, 'stream': True}),
                               headers={'Content-Type': 'application/json', 'Accept': 'text/event-stream'})
            response = connection.getresponse()
            if response.status != 200:
                detail = response.read(1000).decode(errors='replace')
                raise RuntimeError(f'Holo4 returned HTTP {response.status}: {detail}')
            if 'text/event-stream' not in response.getheader('Content-Type', ''):
                raise RuntimeError('Holo4 did not return an event stream.')
            for data in event_data(response):
                if self.cancelled.is_set():
                    raise StreamCancelled()
                if data == '[DONE]':
                    complete = True
                    break
                event = json.loads(data)
                if 'error' in event:
                    raise RuntimeError('Holo4 stream failed: ' + str(event['error'])[:1000])
                for choice in event.get('choices', []):
                    delta = choice.get('delta') or {}
                    if delta.get('tool_calls'):
                        raise RuntimeError('Holo4 returned an unexpected tool call during text chat.')
                    text = delta.get('content')
                    if isinstance(text, str) and text:
                        pieces.append(text)
                        on_delta(text)
                    if choice.get('finish_reason') is not None:
                        finish_reason = choice['finish_reason']
            if self.cancelled.is_set():
                raise StreamCancelled()
            if not complete or finish_reason != 'stop':
                raise RuntimeError('Holo4 stopped before completing this reply. The partial reply was not saved.')
            answer = ''.join(pieces)
            if not answer.strip():
                raise RuntimeError('Holo4 returned an empty reply.')
            return answer
        except (OSError, http.client.HTTPException) as exc:
            if self.cancelled.is_set():
                raise StreamCancelled() from exc
            raise RuntimeError('The connection to Holo4 was interrupted. Start scripts/serve.sh if needed.') from exc
        finally:
            if response is not None:
                response.close()
            connection.close()
            self.socket = None
            self.connection = None


def event_data(response):
    """Read complete SSE frames, including multi-line data and keepalives."""
    lines = []
    for raw in response:
        line = raw.decode('utf-8').rstrip('\r\n')
        if not line:
            if lines:
                yield '\n'.join(lines)
                lines = []
        elif line.startswith('data:'):
            lines.append(line[5:].lstrip(' '))
