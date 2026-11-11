#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo 'This setup requires an Apple Silicon Mac.' >&2
  exit 1
fi
command -v hf >/dev/null || { echo 'Install the Hugging Face CLI (hf) first.' >&2; exit 1; }
if ! command -v llama-server >/dev/null; then
  command -v brew >/dev/null || { echo 'Install Homebrew first: https://brew.sh' >&2; exit 1; }
  brew install llama.cpp
fi
llama-server --version

# Keep model files and download metadata inside this project.
export HF_HOME="$ROOT/.cache/huggingface"
mkdir -p models/holo4 logs artifacts
hf download Hcompany/Holo4-35B-A3B-GGUF \
  q4_k_m.gguf mmproj.f16.gguf README.md LICENSE chat_template.jinja \
  --revision 93400a4 \
  --local-dir "$ROOT/models/holo4"
echo 'Download complete. Run: bash scripts/serve.sh'
