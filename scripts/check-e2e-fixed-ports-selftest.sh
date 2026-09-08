#!/usr/bin/env bash
# Probes check-e2e-fixed-ports.sh (goal 0358 S6) against a throwaway
# git fixture tree, so an edit to the gate cannot silently stop
# catching a literal e2e server port or start flagging the allowlisted
# escape hatch. The gate itself walks `git ls-files`, so each probe
# needs its own tiny git repo (init + add is enough; no commit
# required) rather than a bare fixture directory.
set -euo pipefail
# shellcheck source=lib/git-fixture.sh
source "$(dirname "$0")/lib/git-fixture.sh"

gate="$(cd "$(dirname "$0")" && pwd)/check-e2e-fixed-ports.sh"
fails=0

# probe <expected-exit> <label> <fixture-line>
probe() {
  local want="$1" label="$2" line="$3" root got
  root="$(mktemp -d)"
  git_fixture_init "$root"
  mkdir -p "$root/frontend/e2e/fixtures"
  printf '%s\n' "$line" >"$root/frontend/e2e/fixtures/probe.spec.ts"
  git -C "$root" add -A
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
