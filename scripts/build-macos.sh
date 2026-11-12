#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[[ "$(uname -s)" == Darwin ]] || { echo 'Build the Mac app on macOS.' >&2; exit 1; }
command -v swiftc >/dev/null || { echo 'Install the Xcode Command Line Tools first.' >&2; exit 1; }
npm run check --prefix runtime
npm run build --prefix web
node --import ./runtime/node_modules/tsx/dist/loader.mjs --input-type=module - <<'JS'
import { recordWebBuild } from './runtime/src/startup-cache.ts';
await recordWebBuild(process.cwd());
JS
APP="$ROOT/artifacts/Halo.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$ROOT/.cache/swift"
cp desktop/macos/Info.plist "$APP/Contents/Info.plist"
node --input-type=module - "$ROOT" "$(command -v node)" <<'JS'
import { writeFileSync } from 'node:fs';
const [root, nodeExecutable] = process.argv.slice(2);
writeFileSync(root + '/artifacts/Halo.app/Contents/Resources/local-configuration.json', JSON.stringify({ projectRoot: root, nodeExecutable }));
JS
swiftc -parse-as-library desktop/macos/Halo.swift -o "$APP/Contents/MacOS/Halo" -framework AppKit -framework WebKit -module-cache-path "$ROOT/.cache/swift"
ICONSET="$ROOT/.cache/halo-icon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" docs/design/halo-brand-pack/png/halo-app-icon-dark-1024.png --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  retina=$((size * 2))
  sips -z "$retina" "$retina" docs/design/halo-brand-pack/png/halo-app-icon-dark-1024.png --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/Halo.icns"
codesign --force --sign - --identifier local.halo.desktop "$APP"
echo "Built: $APP"
echo 'This local build uses the current project and installed Node.js. Keep the project in place.'
