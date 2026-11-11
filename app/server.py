"""Loopback-only web app. Browser requests never select a host, tool, or shell command."""
import asyncio
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import queue
import re
import secrets
import signal
import threading
import time
from urllib.parse import urlsplit

from app.core import Desk, LOGGER, model_request
from app.chat_memory import ChatMemory

HOST, PORT = '127.0.0.1', 8765
ORIGIN = f'http://{HOST}:{PORT}'
TOKEN = secrets.token_urlsafe(32)
ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / 'web/dist'
CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"


class ConversationStream:
    def __init__(self, request_id):
        self.request_id = request_id
        self.events = queue.Queue()

    def delta(self, text):
        self.events.put(('delta', text))


class Runtime:
    def __init__(self):
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self.loop.run_forever, daemon=True)
        self.thread.start()
        self.desk = self.call(self.create())

    async def create(self):
        database = Path(os.environ.get('HOLO_CHAT_DB', ROOT / 'data/chat.sqlite3'))
        return Desk(memory=ChatMemory(database))

    def call(self, coroutine, timeout=10):
        return asyncio.run_coroutine_threadsafe(coroutine, self.loop).result(timeout)

    async def open_conversation(self, body):
        request_id = body.get('request_id') or secrets.token_hex(16)
        if not isinstance(request_id, str) or not re.fullmatch(r'[a-zA-Z0-9-]{1,80}', request_id):
            raise ValueError('Invalid conversation request ID.')
        if self.desk.phase in {'stopping', 'cleanup required'}:
            raise ValueError('Wait for sandbox cleanup to complete.')
        channel = ConversationStream(request_id)
        self.desk.launch(self.complete_conversation(channel, body))
        return channel

    async def complete_conversation(self, channel, body):
        try:
            reply = await self.desk.chat(body.get('message'), body.get('desktop') is True,
                                         on_delta=channel.delta, request_id=channel.request_id)
            channel.events.put(('abort', None) if reply is None else ('done', reply))
        except Exception as exc:
            channel.events.put(('error', str(exc)))
            raise

    async def cancel_conversation(self, request_id):
        self.desk.cancel_conversation(request_id)

    async def dispatch(self, path, body):
        desk = self.desk
        if path == '/api/state':
            return desk.snapshot()
        if path == '/api/model':
            try:
                health = await asyncio.to_thread(model_request, '/health', None, 3)
                return {'ok': health.get('status') == 'ok'}
            except Exception as exc:
                return {'ok': False, 'error': str(exc)}
        if path == '/api/stop':
            if desk.phase != 'stopping':
                task = asyncio.create_task(desk.stop())
                desk.tasks.add(task)
                task.add_done_callback(desk.tasks.discard)
            return {'accepted': True}
        if desk.phase in {'stopping', 'cleanup required'}:
            raise ValueError('Cleanup is in progress or needs a retry. Use Stop.')
        if path == '/api/cancel-conversation':
            desk.cancel_conversation(body.get('request_id'))
            return {'accepted': True}
        if path == '/api/clear-chat':
            desk.clear_chat()
            return {'accepted': True}
        if path == '/api/downloads':
            return await desk.list_downloads()
        if path == '/api/forget-login':
            await asyncio.to_thread(desk.vault.delete, body.get('origin'))
            return {'accepted': True}
        if path == '/api/approval-mode':
            desk.set_approval_mode(body.get('enabled'))
            if desk.approve_all and desk.pending and not desk.busy:
                desk.launch(desk.approve(desk.pending['id']))
            return {'accepted': True}
        operations = {
            '/api/start': lambda: desk.start(body.get('network', False)),
            '/api/refresh': desk.refresh,
            '/api/login': lambda: desk.login(body),
            '/api/cancel-login': lambda: desk.cancel_login(body.get('id')),
            '/api/chat': lambda: desk.chat(body.get('message'), body.get('desktop') is True),
            '/api/approve': lambda: desk.approve(body.get('id')),
            '/api/reject': lambda: desk.reject(body.get('id')),
        }
        if path not in operations:
            raise ValueError('Unknown operation.')
        desk.launch(operations[path]())
        return {'accepted': True}

    async def shutdown(self):
        await self.desk.stop()
        tasks = list(self.desk.tasks)
        if tasks:
            await asyncio.wait(tasks, timeout=5)

    def close(self):
        try:
            self.call(self.shutdown(), timeout=60)
        finally:
            self.loop.call_soon_threadsafe(self.loop.stop)
            self.thread.join(timeout=2)


class Handler(BaseHTTPRequestHandler):
    server_version = 'HoloLocal/1'

    def log_message(self, *args):
        pass  # no chat contents, session tokens, or screenshots in access logs

    def respond(self, status, value, mime='application/json'):
        data = json.dumps(value).encode() if mime == 'application/json' else value
        self.send_response(status)
        self.send_header('Content-Type', mime)
        if mime == 'text/event-stream':
            self.send_header('x-vercel-ai-ui-message-stream', 'v1')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', CSP)
        self.send_header('Referrer-Policy', 'no-referrer')
        self.end_headers()
        self.wfile.write(data)

    def trusted(self, api=False):
        # Host validation also prevents DNS rebinding against the loopback service.
        if self.headers.get('Host') != f'{HOST}:{PORT}':
            self.respond(403, {'error': 'Use ' + ORIGIN})
            return False
        origin = self.headers.get('Origin')
        if origin is not None and origin != ORIGIN:
            self.respond(403, {'error': 'Cross-origin requests are blocked.'})
            return False
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':
            self.respond(403, {'error': 'Cross-site requests are blocked.'})
            return False
        if api and not secrets.compare_digest(self.headers.get('X-Local-Token', ''), TOKEN):
            self.respond(403, {'error': 'Session token is missing. Reload this page.'})
            return False
        return True

    def do_GET(self):
        path = urlsplit(self.path).path
        if not self.trusted(api=path.startswith('/api/') and path != '/api/session'):
            return
        if path == '/api/session':
            self.respond(200, {'token': TOKEN})
        elif path in {'/api/state', '/api/model'}:
            self.perform(path, {})
        else:
            if path == '/':
                filename, mime = 'index.html', 'text/html; charset=utf-8'
            elif re.fullmatch(r'/assets/[a-zA-Z0-9_.-]+\.(?:js|css)', path):
                filename = path[1:]
                mime = 'text/javascript; charset=utf-8' if path.endswith('.js') else 'text/css; charset=utf-8'
            else:
                self.respond(404, {'error': 'Not found.'})
                return
            file = STATIC / filename
            if not file.is_file():
                self.respond(503, {'error': 'Web build missing. Run bash scripts/poc.sh.'})
                return
            self.respond(200, file.read_bytes(), mime)

    def do_POST(self):
        if not self.trusted(api=True):
            return
        try:
            if self.headers.get('Content-Type') != 'application/json':
                raise ValueError('Use application/json.')
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 16384:
                raise ValueError('Request must be 1–16,384 bytes.')
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError('Expected a JSON object.')
        except (ValueError, json.JSONDecodeError) as exc:
            self.respond(400, {'error': str(exc)})
            return
        self.perform(urlsplit(self.path).path, body)

    def perform(self, path, body):
        try:
            if path == '/api/conversation':
                self.respond_conversation(body)
                return
            result = self.server.runtime.call(self.server.runtime.dispatch(path, body))
            self.respond(200, result)
        except (BrokenPipeError, ConnectionResetError):
            return
        except ValueError as exc:
            self.respond(400, {'error': str(exc)})
        except Exception as exc:
            self.respond(500, {'error': str(exc)[:1000]})

    def write_event(self, event):
        self.wfile.write(('data: ' + json.dumps(event, ensure_ascii=False) + '\n\n').encode())
        self.wfile.flush()

    def respond_conversation(self, body):
        channel = self.server.runtime.call(self.server.runtime.open_conversation(body))
        part_id = secrets.token_hex(8)
        streamed = False
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('x-vercel-ai-ui-message-stream', 'v1')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', CSP)
            self.send_header('Connection', 'close')
            self.end_headers()
            self.close_connection = True
            self.write_event({'type': 'start', 'messageId': secrets.token_hex(16)})
            self.write_event({'type': 'text-start', 'id': part_id})
            last_write = time.monotonic()
            while True:
                try:
                    kind, value = channel.events.get(timeout=1)
                except queue.Empty:
                    if time.monotonic() - last_write >= 5:
                        self.wfile.write(b': keepalive\n\n')
                        self.wfile.flush()
                        last_write = time.monotonic()
                    continue
                if kind == 'delta':
                    self.write_event({'type': 'text-delta', 'id': part_id, 'delta': value})
                    streamed = True
                    last_write = time.monotonic()
                elif kind == 'done':
                    if not streamed:
                        self.write_event({'type': 'text-delta', 'id': part_id, 'delta': value})
                    self.write_event({'type': 'text-end', 'id': part_id})
                    self.write_event({'type': 'finish', 'finishReason': 'stop'})
                    break
                elif kind == 'abort':
                    self.write_event({'type': 'abort', 'reason': 'Generation stopped.'})
                    break
                elif kind == 'error':
                    self.write_event({'type': 'error', 'errorText': value})
                    break
            self.wfile.write(b'data: [DONE]\n\n')
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            self.server.runtime.call(self.server.runtime.cancel_conversation(channel.request_id))
        except Exception:
            self.server.runtime.call(self.server.runtime.cancel_conversation(channel.request_id))
            LOGGER.exception('Conversation delivery failed')


def main():
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as exc:
        raise SystemExit(f'Cannot listen at {ORIGIN}: {exc}. Run this app from your Terminal; make sure port {PORT} is available.') from exc
    server.daemon_threads = True
    server.runtime = Runtime()
    def interrupt(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupt)
    print(f'Holo Local: {ORIGIN}', flush=True)
    LOGGER.info('Web app started on %s', ORIGIN)
    print('Chat uses Holo4 on port 8080. The VM starts only when you click Start sandbox.', flush=True)
    try:
        server.serve_forever(poll_interval=.25)
    except KeyboardInterrupt:
        print('\nRemoving the POC sandbox...', flush=True)
    finally:
        server.server_close()
        server.runtime.close()


if __name__ == '__main__':
    main()
