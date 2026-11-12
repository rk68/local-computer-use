#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export CUA_HOME="$ROOT/.cache/cua-poc"
export CUA_TELEMETRY=0
export DO_NOT_TRACK=1

command -v node >/dev/null || { echo 'Install Node.js 22.13 or later.' >&2; exit 1; }
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major<22 || major===22 && minor<13) { console.error("Node.js 22.13 or later is required."); process.exit(1); }'
if [[ "${1:-}" == setup || ! -d "$ROOT/runtime/node_modules" ]]; then
  npm ci --prefix "$ROOT/runtime" --no-audit --no-fund
fi

build_web() {
  command -v npm >/dev/null || { echo 'Install Node.js 22.13 or later to build the web app.' >&2; return 1; }
  if [[ "${1:-}" == setup || ! -d "$ROOT/web/node_modules" ]]; then
    npm ci --prefix "$ROOT/web" --no-audit --no-fund
  fi
  npm run build --prefix "$ROOT/web"
}

if [[ "${1:-}" == setup ]]; then
  npm run check --prefix "$ROOT/runtime"
  npm run setup-gateway --prefix "$ROOT/runtime"
  build_web setup
  echo 'Setup complete. Run: bash scripts/poc.sh'
  exit 0
fi

if [[ "${1:-}" == cleanup ]]; then
  exec npm run cleanup --prefix "$ROOT/runtime"
fi
if [[ ! -d "$ROOT/web/node_modules" ]]; then
  npm ci --prefix "$ROOT/web" --no-audit --no-fund
fi
exec npm run halo --prefix "$ROOT/runtime"
