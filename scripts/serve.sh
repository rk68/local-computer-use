#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v llama-server >/dev/null || { echo 'Run: bash scripts/setup.sh' >&2; exit 1; }
for file in q4_k_m.gguf mmproj.f16.gguf; do
  [[ -s "$ROOT/models/holo4/$file" ]] || { echo "Missing $file. Run: bash scripts/setup.sh" >&2; exit 1; }
done
mkdir -p "$ROOT/logs"
LOG="$ROOT/logs/llama-server-$(date +%Y%m%d-%H%M%S).log"
echo "Server log: $LOG"
echo 'Chat UI: http://127.0.0.1:8080'
exec llama-server \
  --model "$ROOT/models/holo4/q4_k_m.gguf" \
  --mmproj "$ROOT/models/holo4/mmproj.f16.gguf" \
  --ctx-size 8192 \
  --parallel 1 \
  --n-gpu-layers 999 \
  --jinja \
  --alias holo4 \
  --host 127.0.0.1 \
  --port 8080 \
  --offline \
  --log-file "$LOG"
