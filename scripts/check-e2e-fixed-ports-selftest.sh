#!/usr/bin/env bash
# Probes check-e2e-fixed-ports.sh (goal 0358 S6) against a throwaway
# git fixture tree, so an edit to the gate cannot silently stop
# catching a literal e2e server port or start flagging the allowlisted
# escape hatch. The gate itself walks `git ls-files`, so each probe
# needs its own tiny git repo (init + add is enough; no commit
# required) rather than a bare fixture directory.
set -euo pipefail

# A git-commit-invoked pre-commit hook (unlike a bare `lefthook run`)
# runs with GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE set to the repo being
# committed; those env vars override `cd "$root"` for every git
# subcommand below, redirecting `init`/`add` at the REAL repo's worktree
# instead of the fixture. Clearing them scopes every git call here to
# its own fixture dir regardless of the calling context.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CEILING_DIRECTORIES 2>/dev/null || true

gate="$(cd "$(dirname "$0")" && pwd)/check-e2e-fixed-ports.sh"
fails=0

# probe <expected-exit> <label> <fixture-line>
probe() {
  local want="$1" label="$2" line="$3" root got
  root="$(mktemp -d)"
  mkdir -p "$root/frontend/e2e/fixtures"
  (
    cd "$root"
    git init -q
    printf '%s\n' "$line" >frontend/e2e/fixtures/probe.spec.ts
    git add -A
  )
  set +e
  (cd "$root" && "$gate" >/dev/null 2>&1)
  got=$?
  set -e
  rm -rf "$root"
  if [ "$got" != "$want" ]; then
    echo "FAIL: want exit $want, got $got: $label" >&2
    fails=$((fails + 1))
  fi
}

probe 1 "a literal 96xx port fails" \
  "const bad = 'http://127.0.0.1:9612'"

probe 1 "a literal port in the old shared-pool range fails" \
  "const port = 9400 + idx"

probe 0 "the allowlisted escape hatch on the same line passes" \
  "const ok = 'http://127.0.0.1:9612' // port-literal: fixture probe, never a real listener"

probe 0 "no literal port passes clean" \
  "const server = await spawnMillServer({ settingsPath, executionDbPath, backupDir })"

if [ "$fails" -ne 0 ]; then
  echo "check-e2e-fixed-ports-selftest: $fails probe(s) failed" >&2
  exit 1
fi
echo "check-e2e-fixed-ports-selftest: OK"
