#!/usr/bin/env bash
# Rebuilds examples/plugins/mill-clipper/vendor/readability.js -- the
# one ESM bundle the Web clipper example plugin imports (docs/goals/
# 0282): Mozilla's Readability (Apache-2.0), the article extractor
# behind Firefox's Reader View. The pinned version below is the only
# input; the bundle is committed so a clone needs no network to run
# the plugin.
set -euo pipefail
READABILITY=0.6.0
ESBUILD=0.28.2
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/examples/plugins/mill-clipper/vendor/readability.js"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
npm init -y >/dev/null
npm install --no-audit --no-fund --silent "@mozilla/readability@$READABILITY" "esbuild@$ESBUILD"
cat > entry.js <<'JS'
export { Readability, isProbablyReaderable } from '@mozilla/readability'
JS
npx esbuild entry.js --bundle --format=esm --minify --target=es2022 \
  --banner:js="// @mozilla/readability@$READABILITY, Apache-2.0. Built by scripts/vendor-readability.sh -- do not edit." \
  --outfile="$OUT"
ls -la "$OUT"
