#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export CUA_HOME="$ROOT/.cache/cua-poc"
export CUA_TELEMETRY=0
export DO_NOT_TRACK=1
export PIP_CACHE_DIR="$ROOT/.cache/pip"

build_web() {
  command -v npm >/dev/null || { echo 'Install Node.js 22.12 or later to build the web app.' >&2; return 1; }
  if [[ "${1:-}" == setup || ! -d "$ROOT/web/node_modules" ]]; then
    npm ci --prefix "$ROOT/web" --no-audit --no-fund
  fi
  npm run build --prefix "$ROOT/web"
}

if [[ "${1:-}" == setup ]]; then
  python3 -m venv "$ROOT/.venv"
  "$ROOT/.venv/bin/python" -m pip install -r requirements-poc.txt
  "$ROOT/.venv/bin/python" -c 'from cua_sandbox import Image, Sandbox; print("Cua SDK import: OK")'
  "$ROOT/.venv/bin/python" -m app.cua_compat
  "$ROOT/.venv/bin/python" scripts/setup_gateway.py
  build_web setup
  echo 'Setup complete. Run: bash scripts/poc.sh'
  exit 0
fi

# Chat works without the optional Cua SDK. The UI explains missing sandbox setup.
PYTHON=python3
if [[ -x "$ROOT/.venv/bin/python" ]]; then PYTHON="$ROOT/.venv/bin/python"; fi
if [[ "${1:-}" == cleanup ]]; then
  exec "$PYTHON" -m app.cleanup
fi
build_web
exec "$PYTHON" -m app.server
