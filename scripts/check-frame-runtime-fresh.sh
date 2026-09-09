#!/usr/bin/env bash
# Enforces goal 0396: the plugin-frame runtime (activation.js,
# bootstrap.js, measure.js, served into every sandboxed plugin frame -- goal 0192,
# goal 0375 S1b) is built from frontend/src/plugin-frame/*.ts, never a
# hand-written copy. Two things drift silently without this gate: a
# hand-written frontend/public/plugin-frame/*.js reappearing (the
# byte-parity test this goal replaces used to be the only thing
# catching that), and a stale/malformed dist/plugin-frame/*.js bundle
# -- one carrying a module import/export statement or an eval() call,
# either of which breaks on the frame's opaque origin and CSP (goal
# 0192's constraints, "become tests on the built output"). Run by
# lefthook (pre-commit) and CI's frontend job, right after `npm run
# build` produces frontend/dist -- same "frontend/dist must exist"
# precondition every other frontend-dependent gate already carries
# (lefthook.yml's own header comment).
#
# MILL_FRAME_ROOT overrides the frontend root this script inspects,
# for check-frame-runtime-fresh-selftest.sh's synthetic fixtures --
# never set in normal use.
set -euo pipefail

root="${MILL_FRAME_ROOT:-$(cd "$(dirname "$0")/.." && pwd)/frontend}"
fails=0

fail() {
  echo "error: $1" >&2
  fails=$((fails + 1))
}

public_dir="$root/public/plugin-frame"
if [ -d "$public_dir" ] && [ -n "$(find "$public_dir" -type f 2>/dev/null)" ]; then
  fail "$public_dir holds a hand-written file -- the plugin-frame runtime is built from frontend/src/plugin-frame/*.ts (goal 0396); delete it, or move new logic into that TypeScript source."
fi

dist_dir="$root/dist/plugin-frame"
for name in activation bootstrap measure; do
  bundle="$dist_dir/$name.js"
  if [ ! -f "$bundle" ]; then
    fail "$bundle is missing -- run 'npm run build' (or 'npm run build:frame') in frontend/ to produce it."
    continue
  fi
  if [ ! -s "$bundle" ]; then
    fail "$bundle is empty."
    continue
  fi
  if grep -nE '^[[:space:]]*(import|export)[[:space:]]' "$bundle" >/dev/null; then
    fail "$bundle contains a module import/export statement -- the frame runs on an opaque origin with no bundler, so the built bundle must stay a self-contained IIFE (goal 0192). Rebuild with 'npm run build:frame'; a stale or hand-edited bundle is the usual cause."
  fi
  if grep -n 'eval(' "$bundle" >/dev/null; then
    fail "$bundle calls eval(), forbidden by the frame's Content-Security-Policy (goal 0375 S1a)."
  fi
done

if [ "$fails" -ne 0 ]; then
  echo "check-frame-runtime-fresh: $fails problem(s) found" >&2
  exit 1
fi
echo "check-frame-runtime-fresh: OK"
