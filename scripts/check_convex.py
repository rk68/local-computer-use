"""Exercise real local Convex with a fake model. Never starts Holo4 or a VM."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import re
import subprocess
import threading
import time
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'web'
REQUESTS = []


def convex(kind, path, args):
    request = Request('http://127.0.0.1:3210/api/' + kind, data=json.dumps({'path': path, 'args': args, 'format': 'json'}).encode(), headers={'Content-Type': 'application/json'})
    value = json.load(urlopen(request, timeout=10))
    if value.get('status') != 'success':
        raise AssertionError(value.get('errorMessage', value))
    return value['value']


class Model(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        REQUESTS.append(body)
        messages = body['messages']
        context = json.dumps(messages)
        if body.get('tools'):
            result = {'id': 'fixture', 'object': 'chat.completion', 'created': 1, 'model': 'holo4', 'choices': [{'index': 0, 'finish_reason': 'tool_calls', 'message': {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'call-fixture', 'type': 'function', 'function': {'name': body['tools'][0]['function']['name'], 'arguments': '{"x":100,"y":200}'}}]}}], 'usage': {'prompt_tokens': 1, 'completion_tokens': 1, 'total_tokens': 2}}
            self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers()
            self.wfile.write(json.dumps(result).encode()); return
        if 'ORCHID' in context:
            answer = 'The codename is ORCHID. '
        elif 'codename' in context.lower():
            answer = 'No codename set. '
        else:
            answer = 'A fixture reply for this thread. '
        slow = any('slow' in json.dumps(m).lower() for m in messages if m['role'] == 'user')
        if not body.get('stream', False):
            time.sleep(8 if slow else .25)
            payload = {'id': 'fixture', 'object': 'chat.completion', 'created': 1, 'model': 'holo4', 'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': answer * (40 if slow else 1)}}], 'usage': {'prompt_tokens': 10, 'completion_tokens': 10, 'total_tokens': 20}}
            data = json.dumps(payload).encode()
            try:
                self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        words = (answer * (40 if slow else 1)).split(' ')
        self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
        try:
            for word in words:
                event = {'id': 'fixture', 'object': 'chat.completion.chunk', 'created': 1, 'model': 'holo4', 'choices': [{'index': 0, 'delta': {'content': word + ' '}, 'finish_reason': None}]}
                self.wfile.write(('data: ' + json.dumps(event) + '\n\n').encode()); self.wfile.flush()
                time.sleep(.12 if slow else .04)
            event['choices'][0].update(delta={}, finish_reason='stop')
            self.wfile.write(('data: ' + json.dumps(event) + '\n\ndata: [DONE]\n\n').encode()); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


def set_model(url):
    subprocess.run(['npx', 'convex', 'env', 'set', 'HALO_MODEL_URL'], cwd=WEB, input=url, text=True, stdout=subprocess.DEVNULL, check=True)


def main():
    from playwright.sync_api import sync_playwright, expect
    model = ThreadingHTTPServer(('127.0.0.1', 0), Model)
    threading.Thread(target=model.serve_forever, daemon=True).start()
    base_url = f'http://127.0.0.1:{model.server_port}/v1'
    token = json.load(urlopen('http://127.0.0.1:8765/api/session'))['token']
    name = 'QA companion ' + str(int(time.time()))
    created_bot = None
    try:
        set_model(base_url)
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless=True)
            try:
                page = browser.new_page(viewport={'width': 1366, 'height': 768})
                # This UI check uses the fake inference endpoint configured below.
                # Advertise only that fixture as ready; never start real weights.
                page.route('**/api/models', lambda route: route.fulfill(content_type='application/json', body=json.dumps({
                    'selected_id': 'fixture', 'phase': 'ready', 'ready': True, 'managed': False, 'error': None, 'progress': None,
                    'models': [{'id': 'fixture', 'name': 'Fixture model', 'detail': 'No real weights', 'license': 'Test only', 'installed': True, 'source': 'https://example.test'}],
                })))
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto('http://127.0.0.1:8765')
                page.get_by_role('button', name='Create bot', exact=True).click()
                page.get_by_label('Bot name', exact=True).fill(name)
                page.get_by_label('Instructions Optional').fill('Keep replies concise.')
                page.get_by_role('dialog').get_by_role('button', name='Create bot', exact=True).click()
                page.get_by_role('heading', name='Chat with ' + name).wait_for()
                workspace = convex('query', 'workspace:list', {'token': token})
                created_bot = next(b for b in workspace['bots'] if b['name'] == name)
                first = next(t for t in workspace['threads'] if t['botId'] == created_bot['_id'])
                page.locator('#message').fill('Set the codename to ORCHID.')
                page.locator('#send').click()
                expect(page.locator('.message.assistant').last).to_contain_text('ORCHID')
                page.get_by_role('button', name='Stop generating').wait_for(state='hidden')
                page.reload()
                expect(page.locator('.message.assistant').last).to_contain_text('ORCHID')
                page.get_by_role('button', name='New thread for ' + name, exact=True).click()
                page.get_by_role('dialog').get_by_label('Thread title').fill('Separate task')
                page.get_by_role('button', name='Create thread', exact=True).click()
                expect(page.get_by_role('button', name='Separate task', exact=True)).to_have_attribute('aria-current', 'page')
                expect(page.locator('#messages')).not_to_contain_text('ORCHID')
                page.locator('#message').fill('What is the codename?')
                page.locator('#send').click()
                expect(page.locator('.message.assistant').last).to_contain_text('No codename set.')
                page.get_by_role('button', name='Stop generating').wait_for(state='hidden')
                page.locator('.bot-group').filter(has_text=name).get_by_role('button', name='New conversation', exact=True).click()
                expect(page.locator('#messages')).to_contain_text('ORCHID')
                page.locator('#message').fill('Give a slow reply.')
                page.locator('#send').click()
                page.get_by_role('button', name='Stop generating').wait_for()
                page.reload()
                page.get_by_role('button', name='Stop generating').wait_for()
                expect(page.locator('.message.assistant').last).to_contain_text('ORCHID')
                page.get_by_role('button', name='Separate task', exact=True).click()
                expect(page.locator('#messages')).not_to_contain_text('ORCHID')
                page.locator('.bot-group').filter(has_text=name).get_by_role('button', name='New conversation', exact=True).click()
                page.get_by_role('button', name='Stop generating').click(timeout=10000)
                page.get_by_role('button', name='Stop generating').wait_for(state='hidden')
                for width, height in [(1280, 720), (1366, 768), (1440, 900), (390, 844)]:
                    page.set_viewport_size({'width': width, 'height': height})
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight'), (width, height)
                page.get_by_role('button', name='Switch bot or thread').click()
                page.get_by_role('button', name='Separate task', exact=True).click()
                expect(page.get_by_role('button', name='Separate task', exact=True)).to_have_attribute('aria-current', 'page')
                page.get_by_role('button', name='Show virtual desktop', exact=True).click()
                page.get_by_role('button', name='Close virtual desktop').click()
                page.set_viewport_size({'width': 1366, 'height': 768})
                page.screenshot(path=str(ROOT / 'artifacts/convex-threads.png'))
                assert not errors, errors
                # Prove API auth, thread-local state, and no implicit VM startup.
                try:
                    convex('query', 'workspace:list', {'token': 'invalid'})
                    raise AssertionError('Unauthenticated read succeeded')
                except AssertionError as error:
                    assert 'Local session expired' in str(error)
                workspace = convex('query', 'workspace:list', {'token': token})
                for thread in [t for t in workspace['threads'] if t['botId'] == created_bot['_id']]:
                    request = Request('http://127.0.0.1:8765/api/state', headers={'X-Local-Token': token, 'X-Halo-Thread': thread['_id']})
                    assert not json.load(urlopen(request))['sandbox']
                assert any('Keep replies concise.' in json.dumps(request['messages']) for request in REQUESTS)
                assert all(request.get('chat_template_kwargs', {}).get('enable_thinking') is False for request in REQUESTS)
                print('PASS: real Convex bot/thread creation, durable history, isolated model context, complete replies across reload/switch, cancellation, auth, mobile drawer, and no VM startup.')
            finally:
                browser.close()
        # Use the same AI SDK provider for a screenshot + typed tool call, with no executor.
        code = '''import { generateText, tool } from 'ai'; import { createOpenAICompatible } from '@ai-sdk/openai-compatible'; import { z } from 'zod';
const provider=createOpenAICompatible({name:'fixture',baseURL:process.env.HALO_TEST_MODEL_URL});
const r=await generateText({model:provider('holo4'),messages:[{role:'user',content:[{type:'text',text:'Find the button.'},{type:'file',data:Buffer.from('iVBORw0KGgo=','base64'),mediaType:'image/png'}]}],tools:{desktop_click:tool({description:'Click the guest',inputSchema:z.object({x:z.number(),y:z.number()})})}});
if(r.toolCalls[0]?.input.x!==100)throw Error('Tool schema mismatch');console.log('PASS: AI SDK screenshot serialization and Zod tool response parsing.');'''
        import os
        subprocess.run(['node', '--input-type=module', '-e', code], cwd=WEB, env={**os.environ, 'HALO_TEST_MODEL_URL': base_url}, check=True)
        assert any('image_url' in json.dumps(request['messages']) for request in REQUESTS)
    finally:
        set_model('http://127.0.0.1:8080/v1')
        if created_bot:
            # Archive only this test bot. No user bots or history are deleted.
            convex('mutation', 'workspace:updateBot', {'token': token, 'botId': created_bot['_id'], 'name': name, 'instructions': 'Fixture test', 'archived': True})
        model.shutdown(); model.server_close()
    print('Holo4 model URL restored. Test bot archived. No real model, VM, credentials, or personal browser profile used.')


if __name__ == '__main__':
    main()
