#!/usr/bin/env bash
# Rebuilds examples/plugins/mill-markmap/vendor/markmap.js -- the one
# ESM bundle the Mind map example plugin imports (docs/goals/0283).
# markmap-lib's no-plugins entry keeps katex/prism/highlight.js out;
# markmap-view brings d3. Pinned versions below are the only inputs;
# the bundle is committed so a clone needs no network to run the
# plugin, and the plugin never uses markmap's CDN autoloader.
set -euo pipefail
MARKMAP_LIB=0.18.12
MARKMAP_VIEW=0.18.12
MARKMAP_COMMON=0.18.9
ESBUILD=0.28.2
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/examples/plugins/mill-markmap/vendor/markmap.js"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
npm init -y >/dev/null
npm install --no-audit --no-fund --silent "markmap-lib@$MARKMAP_LIB" "markmap-view@$MARKMAP_VIEW" "markmap-common@$MARKMAP_COMMON" "esbuild@$ESBUILD"
cat > entry.js <<'JS'
export { Transformer } from 'markmap-lib/no-plugins'
export { Markmap, globalCSS } from 'markmap-view'
JS
npx esbuild entry.js --bundle --format=esm --minify --target=es2022 \
  --banner:js="// markmap-lib@$MARKMAP_LIB (no-plugins) + markmap-view@$MARKMAP_VIEW, MIT. Built by scripts/vendor-markmap.sh -- do not edit." \
  --outfile="$OUT"
ls -la "$OUT"
