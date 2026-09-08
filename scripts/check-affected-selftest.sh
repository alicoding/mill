#!/usr/bin/env bash
# Probes scripts/list-affected-go-packages.sh's per-event diff-base
# resolution against two real commits on this branch (CI run
# 34249279901, job 102149916582): a merge_group run failed with
# `mapfile: command not found` -- CI's test-go-affected job runs on
# macos-latest, whose system /bin/bash is 3.2 and predates the
# mapfile/readarray builtin -- and, separately, the script only ever
# resolved a diff base for pull_request explicitly; merge_group's
# GITHUB_BASE_REF is always empty, so it silently fell through to the
# "compare to parent commit" branch instead of the merge queue's own
# base. This script itself avoids every bash-4-only construct for the
# same reason: it runs on the same macos-latest runner.
#
# Invokes the real script via the LITERAL /bin/bash path, not a `bash`
# PATH lookup -- CI's default `shell: bash` step invokes that literal
# path (confirmed against the failed run's own "shell: /bin/bash -e
# {0}" log line), which is exactly what let the mapfile regression
# through un-caught locally.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
target="$repo_root/scripts/list-affected-go-packages.sh"
cd "$repo_root"

fails=0

# The root package's //go:embed all:frontend/dist needs at least one
# file present to type-check -- a stub is enough for the target script's
# own `go list -json ./...`. Removed again only if this probe created
# it: a developer's real build stays untouched.
dist_created=false
if [ ! -d frontend/dist ] || [ -z "$(ls -A frontend/dist 2>/dev/null)" ]; then
  mkdir -p frontend/dist
  : >frontend/dist/.affected-selftest-stub
  dist_created=true
fi

pr_base_ref="mill-affected-selftest-base-$$"

cleanup() {
  if [ "$dist_created" = true ]; then
    rm -rf frontend/dist
  fi
  git update-ref -d "refs/remotes/origin/$pr_base_ref" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Two real, adjacent commits on this branch where the later one touched
# Go files -- BASE_COMMIT...HEAD_COMMIT is a real, known diff, not a
# fixture repo.
HEAD_COMMIT="$(git log -1 --format=%H -- '*.go')"
BASE_COMMIT="$(git rev-parse "${HEAD_COMMIT}^")"

if [ -z "$HEAD_COMMIT" ] || [ -z "$BASE_COMMIT" ]; then
  echo "check-affected-selftest: could not find a commit pair with a Go-file diff to probe against" >&2
  exit 1
fi

# A fabricated remote-tracking ref stands in for the real `git fetch
# origin <base>` a pull_request run would do -- resolve_base's own `git
# fetch --quiet origin "$GITHUB_BASE_REF" || true` tolerates the fetch
# failing against a branch name that only exists locally.
git update-ref "refs/remotes/origin/$pr_base_ref" "$BASE_COMMIT"

run() {
  # run <event> [EXTRA_ENV=val ...] -- invokes the target script via the
  # literal /bin/bash path in dry-run mode (no `go test -race`) and
  # prints its stdout (the selection summary; command substitution
  # already excludes stderr, where a benign `git fetch` failure against
  # the fabricated pull_request base ref below would otherwise land).
  local event="$1"
  shift
  env GITHUB_EVENT_NAME="$event" LIST_AFFECTED_HEAD_REF="$HEAD_COMMIT" LIST_AFFECTED_DRY_RUN=1 \
    "$@" /bin/bash "$target"
}

# probe <label> <want-exit> <want-substring> <event> [extra env...]
probe() {
  local label="$1" want_exit="$2" want_substr="$3" event="$4" out rc
  shift 4
  set +e
  out="$(run "$event" "$@")"
  rc=$?
  set -e
  if [ "$rc" != "$want_exit" ]; then
    echo "FAIL: $label: want exit $want_exit, got $rc" >&2
    echo "$out" >&2
    fails=$((fails + 1))
    return
  fi
  case "$out" in
  *"$want_substr"*) ;;
  *)
    echo "FAIL: $label: expected output to contain: $want_substr" >&2
    echo "$out" >&2
    fails=$((fails + 1))
    ;;
  esac
  PROBE_OUTPUT="$out"
}

# pull_request: a real merge-base diff against the fabricated origin ref.
probe "pull_request resolves the real base" 0 "Diff base \`$BASE_COMMIT\`" \
  pull_request "GITHUB_BASE_REF=$pr_base_ref"
pr_output="$PROBE_OUTPUT"
case "$pr_output" in
*"no changed Go files"* | *"could not be determined"*)
  echo "FAIL: pull_request: expected a real package selection, got a fallback/empty result" >&2
  echo "$pr_output" >&2
  fails=$((fails + 1))
  ;;
esac

# merge_group: MERGE_GROUP_BASE_SHA (ci.yml threads in
# github.event.merge_group.base_sha) is the only source of truth --
# GITHUB_BASE_REF is unset here, matching the real event.
probe "merge_group resolves its own base_sha" 0 "Diff base \`$BASE_COMMIT\`" \
  merge_group "MERGE_GROUP_BASE_SHA=$BASE_COMMIT"
mg_output="$PROBE_OUTPUT"

# The three events, given the same two real commits, must select the
# EXACT SAME package set -- this is the "packages touched between two
# real commits on this branch" assertion, cross-checked against
# pull_request's independently-resolved base instead of a hand-kept list
# of package names that would drift as the import graph changes.
if [ "$pr_output" != "$mg_output" ]; then
  echo "FAIL: merge_group's selection differs from pull_request's for the same commit pair" >&2
  echo "--- pull_request ---" >&2
  echo "$pr_output" >&2
  echo "--- merge_group ---" >&2
  echo "$mg_output" >&2
  fails=$((fails + 1))
fi

# push (and local/manual runs): no GITHUB_BASE_REF, no
# MERGE_GROUP_BASE_SHA -- falls back to comparing against the immediate
# parent commit, which for this exact HEAD_COMMIT/BASE_COMMIT pair is the
# same diff as the two probes above.
probe "push compares against the parent commit" 0 "Diff base \`$BASE_COMMIT\`" push
push_output="$PROBE_OUTPUT"
if [ "$push_output" != "$pr_output" ]; then
  echo "FAIL: push's selection differs from pull_request's for the same commit pair" >&2
  echo "--- pull_request ---" >&2
  echo "$pr_output" >&2
  echo "--- push ---" >&2
  echo "$push_output" >&2
  fails=$((fails + 1))
fi

# merge_group with an unresolvable base (no MERGE_GROUP_BASE_SHA, e.g. a
# workflow wiring regression) must fall back to "everything affected",
# never a false "nothing changed" that would silently skip coverage.
probe "merge_group with no base_sha falls back to everything-affected" 0 "could not be determined" merge_group
case "$PROBE_OUTPUT" in
*"no changed Go files"*)
  echo "FAIL: merge_group with no base_sha read as an empty diff instead of an unresolvable base" >&2
  echo "$PROBE_OUTPUT" >&2
  fails=$((fails + 1))
  ;;
esac

if [ "$fails" -ne 0 ]; then
  echo "check-affected-selftest: $fails probe(s) failed" >&2
  exit 1
fi
echo "check-affected-selftest: OK"
