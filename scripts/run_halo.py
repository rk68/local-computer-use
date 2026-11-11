"""Start the local Convex backend and web executor. Never starts a model or VM."""
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import sys
import time
from urllib.request import Request, ProxyHandler, build_opener

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'web'
CACHE = ROOT / '.cache/halo'


def listening(port):
    with socket.socket() as connection:
        connection.settimeout(.2)
        return connection.connect_ex(('127.0.0.1', port)) == 0


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    token_file = CACHE / 'session-token'
    if not token_file.exists():
        token_file.write_text(secrets.token_urlsafe(32))
    token_file.chmod(0o600)
    token = token_file.read_text().strip()
    envfile = WEB / '.env.local'
    if envfile.exists():
        settings = dict(line.split('=', 1) for line in envfile.read_text().splitlines() if '=' in line and not line.startswith('#'))
        deployment = settings.get('CONVEX_DEPLOYMENT', '')
        if not deployment.startswith(('anonymous:', 'local:')) or settings.get('VITE_CONVEX_URL') != 'http://127.0.0.1:3210':
            raise SystemExit('Halo requires this project’s local Convex deployment on port 3210. Cloud deployments are not enabled by this launcher.')
    if listening(8765) or listening(3210):
        raise SystemExit('Halo or Convex is already running. Stop those project processes before running bash scripts/poc.sh again.')
    environment = {**os.environ, 'CONVEX_AGENT_MODE': 'anonymous', 'HALO_SESSION_TOKEN': token, 'HALO_CONVEX_URL': 'http://127.0.0.1:3210',
        'NODE_OPTIONS': os.environ.get('NODE_OPTIONS', '') + ' --require ' + json.dumps(str(ROOT / 'scripts/convex_loopback.cjs'))}
    children = []
    logs = []
    (ROOT / 'logs').mkdir(exist_ok=True)
    def stop(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    try:
        log = (ROOT / 'logs/convex.log').open('a')
        logs.append(log)
        convex = subprocess.Popen(['npx', 'convex', 'dev', '--typecheck', 'enable'], cwd=WEB, env=environment, stdout=log, stderr=log, start_new_session=True)
        children.append(convex)
        for _ in range(240):
            if convex.poll() is not None:
                raise RuntimeError('Convex stopped. Read logs/convex.log.')
            if envfile.exists() and listening(3210):
                break
            time.sleep(.5)
        else:
            raise RuntimeError('Convex did not start. Read logs/convex.log.')
        subprocess.run(['npx', 'convex', 'env', 'set', 'HALO_SESSION_TOKEN'], cwd=WEB, env=environment, input=token, text=True, check=True, stdout=subprocess.DEVNULL)
        # A listening port alone does not mean that application functions are deployed.
        http = build_opener(ProxyHandler({}))
        for _ in range(120):
            if convex.poll() is not None:
                raise RuntimeError('Convex stopped. Read logs/convex.log.')
            try:
                request = Request('http://127.0.0.1:3210/api/query', data=json.dumps({'path': 'workspace:list', 'args': {'token': token}, 'format': 'json'}).encode(), headers={'Content-Type': 'application/json'})
                with http.open(request, timeout=2) as response:
                    if json.load(response).get('status') == 'success':
                        break
            except Exception:
                pass
            time.sleep(.5)
        else:
            raise RuntimeError('Convex functions did not become ready. Read logs/convex.log.')
        build_log = (ROOT / 'logs/web-build.log').open('w')
        logs.append(build_log)
        subprocess.run(['npm', 'run', 'build'], cwd=WEB, env=environment, check=True, stdout=build_log, stderr=subprocess.STDOUT)
        executor = subprocess.Popen([sys.executable, '-m', 'app.server'], cwd=ROOT, env=environment, start_new_session=True)
        children.append(executor)
        print('Halo: http://127.0.0.1:8765 · Convex local: 3210', flush=True)
        print('This command does not start the model or a sandbox.', flush=True)
        while all(child.poll() is None for child in children):
            time.sleep(.5)
        raise RuntimeError('A Halo process stopped. Read logs/convex.log and logs/poc.log.')
    except KeyboardInterrupt:
        pass
    finally:
        for child in reversed(children):
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=60)
                except subprocess.TimeoutExpired:
                    # Preserve ownership records so cleanup can be retried.
                    os.killpg(child.pid, signal.SIGKILL)
        for log in logs:
            log.close()


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError:
        raise SystemExit('Halo setup failed. Read logs/convex.log and logs/web-build.log.')
    except RuntimeError as error:
        raise SystemExit(str(error))
