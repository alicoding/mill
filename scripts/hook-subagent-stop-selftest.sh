#!/usr/bin/env bash
# Probes hook-subagent-stop.sh (goal 0414 S3) against synthetic
# worktree fixtures under mktemp, targeted via
# MILL_SUBAGENT_STOP_WORKTREE_GLOB so no real
# /Users/ali/code/mill-wt-* worktree is ever touched by this selftest.
# Same fixture shape as check-agent-definitions-selftest.sh:
# git_fixture_init gives each case its own throwaway repo.
set -euo pipefail
# shellcheck source=lib/git-fixture.sh
source "$(dirname "$0")/lib/git-fixture.sh"

hook="$(cd "$(dirname "$0")" && pwd)/hook-subagent-stop.sh"
fails=0

# probe <expected-exit> <label> <setup-fn>
probe() {
  local want="$1" label="$2" setup_fn="$3" root got out
  root="$(mktemp -d)"
  "$setup_fn" "$root"
  set +e
  out="$(echo '{}' | MILL_SUBAGENT_STOP_WORKTREE_GLOB="$root/*" MILL_SUBAGENT_STOP_STALE_MINUTES=30 bash "$hook" 2>&1)"
  got=$?
  set -e
  rm -rf "$root"
  if [ "$got" != "$want" ]; then
    echo "FAIL: want exit $want, got $got: $label -- $out" >&2
    fails=$((fails + 1))
  fi
}

dirty_goal_branch() {
  local dir="$1/wt"
  git_fixture_init "$dir"
  git -C "$dir" checkout -q -b goal/0000-fixture
  echo "seed" >"$dir/seed.txt"
  git_fixture_commit_all "$dir" "seed"
  echo "dirty" >>"$dir/seed.txt"
}

clean_goal_branch() {
  local dir="$1/wt"
  git_fixture_init "$dir"
  git -C "$dir" checkout -q -b goal/0000-fixture
  echo "seed" >"$dir/seed.txt"
  git_fixture_commit_all "$dir" "seed"
}

dirty_non_goal_branch() {
  local dir="$1/wt"
  git_fixture_init "$dir"
  echo "seed" >"$dir/seed.txt"
  git_fixture_commit_all "$dir" "seed"
  echo "dirty" >>"$dir/seed.txt"
}

probe 2 "dirty goal-branch worktree blocks (exit 2)" dirty_goal_branch
probe 0 "clean goal-branch worktree passes (exit 0)" clean_goal_branch
probe 0 "dirty non-goal-branch worktree passes (exit 0)" dirty_non_goal_branch

# The mtime heuristic: a dirty goal-branch worktree with no file
# touched inside the window is treated as stale (not this stopping
# agent's), not as a match.
dirty_goal_branch_stale() {
  local dir="$1/wt"
  git_fixture_init "$dir"
  git -C "$dir" checkout -q -b goal/0000-fixture
  echo "seed" >"$dir/seed.txt"
  git_fixture_commit_all "$dir" "seed"
  echo "dirty" >>"$dir/seed.txt"
  touch -t 202001010000 "$dir/seed.txt"
}
probe 0 "dirty goal-branch worktree older than the window passes (exit 0)" dirty_goal_branch_stale

# No worktree at all under the glob -> exit 0 (fail open).
no_worktree() {
  mkdir -p "$1/empty"
}
probe 0 "no matching worktree passes (exit 0)" no_worktree

# builder.md's templated worktree path and the hook's default glob
# must name the same prefix, or a builder's real worktree is invisible
# to this hook (goal 0414 S4; #880 built under mill-worktrees/ instead,
# which the mill-wt-* glob never scans).
builder_md="$(cd "$(dirname "$hook")/.." && pwd)/.claude/agents/builder.md"
builder_prefix="$(grep -o 'mill-wt-<goal>-<slice>' "$builder_md" | head -1 | sed 's/<.*//')"
hook_prefix="$(grep -o 'mill-wt-\*' "$hook" | head -1 | sed 's/\*//')"
if [ -z "$builder_prefix" ] || [ -z "$hook_prefix" ]; then
  echo "FAIL: could not extract a worktree path prefix from builder.md or the hook" >&2
  fails=$((fails + 1))
elif [ "$builder_prefix" != "$hook_prefix" ]; then
  echo "FAIL: builder.md prefix '$builder_prefix' disagrees with hook glob prefix '$hook_prefix'" >&2
  fails=$((fails + 1))
else
  echo "hook-subagent-stop-selftest: builder.md/hook worktree prefix agree ($hook_prefix)"
fi

if [ "$fails" -ne 0 ]; then
  echo "hook-subagent-stop-selftest: $fails probe(s) failed" >&2
  exit 1
fi
echo "hook-subagent-stop-selftest: OK"
