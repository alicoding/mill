#!/usr/bin/env bash
# Probes scripts/list-affected-go-packages.sh's per-event diff-base
# resolution (CI run 34249279901, job 102149916582): a merge_group run
# failed with a bash-4-only builtin not found on CI's macos-latest
# system /bin/bash (3.2), and separately the script only ever resolved a
# base for pull_request explicitly -- merge_group's GITHUB_BASE_REF is
# always empty, so it silently fell through to "compare to parent
# commit" instead of the merge queue's own base.
#
# Builds its own throwaway Go module as two REAL commits (via
# scripts/lib/git-fixture.sh, goal 0394's isolation helper -- never the
# real mill checkout or a ref borrowed from the real `origin` remote,
# which a shallow/queue checkout on the CI runner doesn't carry: a
# fabricated `refs/remotes/origin/<name>` ref survived locally but a
# real `git fetch origin <name>` against the genuine GitHub remote
# during CI's own checkout state pruned or otherwise never resolved it,
# job 102168238051's actual failure) and asserts the exact base SHA and
# package selection the target script computes against them. Invokes
# the target script via the LITERAL /bin/bash path, not a `bash` PATH
# lookup -- CI's default `shell: bash` step invokes that literal path
# (the failed run's own "shell: /bin/bash -e {0}" log line) -- so a
# bash-4-only regression fails here the same way it failed in CI.
# Bash-3.2-safe throughout (scripts/check-bash-portability.sh): this
# selftest itself runs on the same macos-latest runner.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/git-fixture.sh
source "$repo_root/scripts/lib/git-fixture.sh"

fixture="$(mktemp -d)"
cleanup() { rm -rf "$fixture"; }
trap cleanup EXIT

git_fixture_init "$fixture"

mkdir -p "$fixture/pkga" "$fixture/pkgb" "$fixture/scripts"

# A trivial, dependency-free module: root package imports neither pkga
# nor pkgb (so it never gets selected), pkgb imports pkga (so a change
# to pkga alone must also select pkgb via the transitive-Deps rule).
cat >"$fixture/go.mod" <<'EOF'
module fixture.example/affectedselftest

go 1.21
EOF
cat >"$fixture/main.go" <<'EOF'
package main

func main() {}
EOF
cat >"$fixture/pkga/a.go" <<'EOF'
package pkga

func A() string { return "a" }
EOF
cat >"$fixture/pkgb/b.go" <<'EOF'
package pkgb

import "fixture.example/affectedselftest/pkga"

func B() string { return pkga.A() }
EOF

cp "$repo_root/scripts/list-affected-go-packages.sh" "$fixture/scripts/list-affected-go-packages.sh"
chmod +x "$fixture/scripts/list-affected-go-packages.sh"

git_fixture_commit_all "$fixture" "initial"
BASE_COMMIT="$(git -C "$fixture" rev-parse HEAD)"

# A real, known diff: only pkga's file changes.
cat >"$fixture/pkga/a.go" <<'EOF'
package pkga

func A() string { return "a2" }
EOF
git_fixture_commit_all "$fixture" "change pkga"
HEAD_COMMIT="$(git -C "$fixture" rev-parse HEAD)"

# Stands in for the real `git fetch origin <base>` a pull_request run
# does -- entirely inside the isolated fixture repo, which carries no
# real `origin` remote to fetch from or collide with.
PR_BASE_REF_NAME="fixture-base"
git -C "$fixture" update-ref "refs/remotes/origin/$PR_BASE_REF_NAME" "$BASE_COMMIT"

PKG_ROOT="fixture.example/affectedselftest"
PKG_A="$PKG_ROOT/pkga"
PKG_B="$PKG_ROOT/pkgb"

# The real script's own summary format (list-affected-go-packages.sh):
# one directly-changed package (pkga), two selected once pkgb's
# transitive dependency on it is followed.
expected_real_diff="$(printf '### test-go-affected\nDiff base `%s`: 1 package(s) directly changed, 2 selected with dependents:\n```\n%s\n%s\n```' \
  "$BASE_COMMIT" "$PKG_A" "$PKG_B")"

# The fallback summary format when no base could be resolved: all 3
# fixture packages (root, pkga, pkgb) selected, never a false "nothing
# changed".
expected_fallback="$(printf '### test-go-affected\nDiff base could not be determined for event `merge_group` -- running the full 3-package set as a safe fallback.')"

fails=0

# run <event> [EXTRA_ENV=val ...] -- invokes the fixture's own copy of
# the target script via the literal /bin/bash path, dry-run (no `go
# test -race`), and prints its stdout.
run() {
  # -u GITHUB_STEP_SUMMARY: a REAL CI job always sets this (every step
  # gets one), and if left inherited the target script's own summary()
  # writes to that file instead of returning it on stdout -- the actual
  # CI failure this reproduced (job 102248351460: all four probes saw
  # empty output only under a genuine Actions job, never locally, where
  # the var is unset). -u GITHUB_BASE_REF/MERGE_GROUP_BASE_SHA: cleared
  # so only the explicit per-probe env below can set them, never an
  # ambient value this job's own step happens to carry.
  local event="$1"
  shift
  env -u GITHUB_STEP_SUMMARY -u GITHUB_BASE_REF -u MERGE_GROUP_BASE_SHA \
    GITHUB_EVENT_NAME="$event" LIST_AFFECTED_HEAD_REF="$HEAD_COMMIT" LIST_AFFECTED_DRY_RUN=1 \
    "$@" /bin/bash "$fixture/scripts/list-affected-go-packages.sh"
}

# probe <label> <want-output> <event> [extra env...]
probe() {
  local label="$1" want="$2" event="$3" out rc
  shift 3
  set +e
  out="$(run "$event" "$@")"
  rc=$?
  set -e
  if [ "$rc" != 0 ]; then
    echo "FAIL: $label: exited $rc" >&2
    echo "$out" >&2
    fails=$((fails + 1))
    return
  fi
  if [ "$out" != "$want" ]; then
    echo "FAIL: $label: output mismatch" >&2
    echo "--- want ---" >&2
    echo "$want" >&2
    echo "--- got ---" >&2
    echo "$out" >&2
    fails=$((fails + 1))
  fi
}

probe "pull_request resolves the merge-base against its own origin ref" \
  "$expected_real_diff" pull_request "GITHUB_BASE_REF=$PR_BASE_REF_NAME"

probe "merge_group resolves MERGE_GROUP_BASE_SHA, not github.base_ref" \
  "$expected_real_diff" merge_group "MERGE_GROUP_BASE_SHA=$BASE_COMMIT"

probe "push compares against the immediate parent commit" \
  "$expected_real_diff" push

probe "merge_group with no base_sha falls back to every package, never a false nothing-changed" \
  "$expected_fallback" merge_group

if [ "$fails" -ne 0 ]; then
  echo "check-affected-selftest: $fails probe(s) failed" >&2
  exit 1
fi
echo "check-affected-selftest: OK"
