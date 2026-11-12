#!/usr/bin/env bash
set -euo pipefail

[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || {
  echo 'Halo requires an Apple silicon Mac.' >&2
  exit 1
}
xcode-select -p >/dev/null 2>&1 || {
  echo 'Install the Apple Command Line Tools with xcode-select --install, then run this installer again.' >&2
  exit 1
}

INSTALL_DIR="${HALO_INSTALL_DIR:-$HOME/.local/share/halo}"
if [[ -e "$INSTALL_DIR" ]]; then
  remote="$(git -C "$INSTALL_DIR" remote get-url origin 2>/dev/null || true)"
  case "$remote" in
    https://github.com/rk68/halo|https://github.com/rk68/halo.git|git@github.com:rk68/halo.git|github-personal:rk68/halo.git) ;;
    *) echo "Installation stopped. $INSTALL_DIR is not a Halo checkout." >&2; exit 1 ;;
  esac
else
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --depth 1 https://github.com/rk68/halo.git "$INSTALL_DIR"
fi

exec bash "$INSTALL_DIR/halo" install
