#!/usr/bin/env bash
# Enforces CLAUDE.md's 500-line-per-file convention across every Go/TS/TSX
# file Mill actually owns. Run by lefthook (pre-commit) and CI's
# file-loc-limit job -- lefthook.yml's own header says it mirrors CI, so
# this lives as one script both call, not two copies that can drift.
set -euo pipefail

limit=500

# Generated bindings (Wails codegen, not hand-written), the gomobile-
# toolchain scaffold under build/ios and build/android (vendored, not
# Mill's own code -- same carve-out ci.yml's build-go job already applies),
# the plugin SDK's committed declarations (emitted by tsc from
# frontend/src/plugins/sdk.ts via `npm run sdk:build`, which IS under the
# limit -- the emitter owns this file's shape, and check-sdk-freshness.sh
# is what keeps it honest), and frontend/dist/node_modules are all out of
# scope: this convention is about keeping *Mill's own hand-written
# source* reviewable as a single unit, not about code nobody here
# maintains the shape of.
exclude_regex='^(frontend/bindings/|frontend/plugin-sdk/|build/ios/|build/android/|frontend/dist/|frontend/node_modules/)'

violations=0
while IFS= read -r -d '' file; do
  case "$file" in
    *.go | *.ts | *.tsx) ;;
    *) continue ;;
  esac
  if [[ "$file" =~ $exclude_regex ]]; then
    continue
  fi
  if [[ ! -f "$file" ]]; then
    continue
  fi
  lines=$(wc -l <"$file")
  if ((lines > limit)); then
    echo "  $file: $lines lines (limit $limit)"
    violations=$((violations + 1))
  fi
done < <(git ls-files -z)

if ((violations > 0)); then
  echo "error: $violations file(s) exceed the ${limit}-line convention (CLAUDE.md) -- split along a real seam, don't truncate arbitrarily." >&2
  exit 1
fi
