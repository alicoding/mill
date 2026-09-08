#!/usr/bin/env bash
# Probes check-framework-api-first.sh's location check (goal 0385) against
# throwaway git repos, so an edit to the gate cannot silently stop
# rejecting a cgo/Objective-C file dropped outside internal/adapters/**.
set -euo pipefail

# A git-commit-invoked pre-commit hook (unlike a bare `lefthook run`)
# runs with GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE set to the repo being
# committed; those env vars override `-C <fixturedir>` for every git
# subcommand below, redirecting `init`/`add` at the REAL repo's worktree
# instead of the fixture. Clearing them scopes every git call here to
# its own `-C` target regardless of the calling context.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CEILING_DIRECTORIES 2>/dev/null || true

gate="$(cd "$(dirname "$0")" && pwd)/check-framework-api-first.sh"
fails=0
wails_version="v3.0.0-beta.99"

# fixture <dir> builds a throwaway git repo with go.mod pinned to
# $wails_version -- the gate only needs files in the git index, no commit.
fixture() {
  local dir="$1"
  mkdir -p "$dir"
  git -C "$dir" init -q
  printf 'module fixture\n\ngo 1.23\n\nrequire (\n\tgithub.com/wailsapp/wails/v3 %s\n)\n' "$wails_version" >"$dir/go.mod"
}

# probe <expected-exit> <label> <dir>
probe() {
  local want="$1" label="$2" dir="$3" got
  git -C "$dir" add -A
  set +e
  ( cd "$dir" && bash "$gate" >/dev/null 2>&1 )
  got=$?
  set -e
  if [ "$got" != "$want" ]; then
    echo "FAIL: want exit $want, got $got: $label" >&2
    fails=$((fails + 1))
  fi
}

good="$(mktemp -d)"
fixture "$good"
mkdir -p "$good/internal/adapters/fixturesvc"
cat >"$good/internal/adapters/fixturesvc/fixture_darwin.go" <<EOF
package fixturesvc

// framework-api-audit: wails/v3@$wails_version lacks a fixture capability.
import "C"
EOF
probe 0 "cgo marker under internal/adapters/** with a fresh audit line passes" "$good"

bad="$(mktemp -d)"
fixture "$bad"
mkdir -p "$bad/internal/services/foosvc"
cat >"$bad/internal/services/foosvc/native_darwin.go" <<EOF
package foosvc

// framework-api-audit: wails/v3@$wails_version lacks a fixture capability.
import "C"
EOF
probe 1 "cgo marker outside internal/adapters/** fails even with a fresh audit line" "$bad"

rm -rf "$good" "$bad"

if [ "$fails" -ne 0 ]; then
  echo "check-framework-api-first-selftest: $fails probe(s) failed" >&2
  exit 1
fi
echo "check-framework-api-first-selftest: OK"
