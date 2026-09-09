#!/usr/bin/env bash
# Removes a worktree only once its branch's PR has actually landed
# (MERGED or CLOSED) -- age is not the signal (goal 0403: an age-based
# sweep once cost a queued e2e run its worktree mid-run). Every other
# worktree is left alone, including one whose PR is open and armed or
# sitting in the merge queue: it hasn't landed yet.
#
# Skip reasons, checked in order:
#   (a) a live process has its cwd at the worktree root, or a command
#       line naming the path -- `lsof +D` (recursive) is too slow across
#       many worktrees, so this uses a `ps` command-line grep (catches
#       build/watch tools invoked with the full path) plus
#       `lsof -d cwd -a +d <path>` (non-recursive cwd check at the root
#       only; a process whose cwd is a subdirectory is not caught by the
#       lsof half, the ps half still catches it when the tool's own
#       argv/cmdline includes the path, which build tooling normally does).
#   (b) the branch has commits not pushed to origin/<branch>, or no
#       upstream is configured to check against.
#   (c) the tree is dirty, or a merge/rebase is in progress
#       (MERGE_HEAD, rebase-merge/, rebase-apply/).
#   (d) no PR exists for the branch, or its PR is open and neither armed
#       (autoMergeRequest) nor in the merge queue.
# Anything not skipped is removed only when its PR is MERGED or CLOSED
# (`git worktree remove --force` + `git branch -D`); PR state, not (d),
# is what gates removal -- a merged PR removes its worktree regardless
# of how (d) would have evaluated.
#
# Never touches the main checkout (the first entry `git worktree list`
# reports). Called by the orchestrator's tick, not by any automatic
# hook. Always exits 0; `--dry-run` prints verdicts without removing.
#
# Last step: a guarded Go build-cache trim (goal 0403 S2f), so a tick
# that doesn't land on the LaunchAgent's own 30-minute cadence still
# gets a chance at it. gocache-trim.sh no-ops on its own when hardcache
# isn't installed or a go build/test/vet/generate/install/run,
# golangci-lint, wails3 or lefthook process is running anywhere on the
# machine.
#
# A git-commit-invoked pre-commit hook exports GIT_DIR/GIT_WORK_TREE/
# GIT_INDEX_FILE (and the rest of git's local-repo environment) for the
# repo being committed; those override every `-C <path>` call below,
# so every worktree this script checks would resolve against that ONE
# inherited repo instead of the actual worktree path (confirmed live: a
# nested git status call against a different directory, run under an
# inherited GIT_DIR, silently ignores that directory -- goal 0394's
# class). Cleared unconditionally so this script's verdicts are correct
# regardless of what invoked it.
set -uo pipefail

for _git_local_var in $(git rev-parse --local-env-vars 2>/dev/null || true); do
  unset "$_git_local_var"
done

dry=0
[ "${1:-}" = "--dry-run" ] && dry=1

main_worktree="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
if [ -z "$main_worktree" ]; then
  echo "sweep-worktrees: could not determine the main worktree, exiting" >&2
  exit 0
fi

has_gh=1
command -v gh >/dev/null 2>&1 || has_gh=0
has_jq=1
command -v jq >/dev/null 2>&1 || has_jq=0

origin_url="$(git -C "$main_worktree" remote get-url origin 2>/dev/null || true)"  # git-isolation:allow -- real worktree list, not a fixture; local git env vars are cleared above
repo_slug="$(echo "${origin_url%.git}" | awk -F'[:/]' '{print $(NF-1)"/"$NF}')"

# worktree_busy <path> -- true (0) when a live process is using it.
worktree_busy() {
  local path="$1" snapshot
  snapshot="$(ps -axo pid=,command= 2>/dev/null)"
  if echo "$snapshot" | grep -F -- "$path" >/dev/null 2>&1; then
    return 0
  fi
  if command -v lsof >/dev/null 2>&1; then
    if lsof -d cwd -a +d "$path" 2>/dev/null | grep -q .; then
      return 0
    fi
  fi
  return 1
}

# branch_unpushed <path> <branch> -- true (0) when there are commits not
# on origin/<branch>, or no upstream to compare against.
branch_unpushed() {
  local path="$1" branch="$2" ahead
  ahead="$(git -C "$path" rev-list --count "origin/${branch}..HEAD" 2>/dev/null)" || return 0  # git-isolation:allow -- real worktree list, not a fixture; local git env vars are cleared above
  [ -z "$ahead" ] && return 0
  [ "$ahead" -gt 0 ]
}

# tree_dirty_or_mid_merge <path> -- true (0) when the tree is dirty or a
# merge/rebase is in progress.
tree_dirty_or_mid_merge() {
  local path="$1" gitdir
  [ -n "$(git -C "$path" status --porcelain 2>/dev/null)" ] && return 0  # git-isolation:allow -- real worktree list, not a fixture; local git env vars are cleared above
  gitdir="$(git -C "$path" rev-parse --git-dir 2>/dev/null)" || return 1  # git-isolation:allow -- real worktree list, not a fixture; local git env vars are cleared above
  [ -f "$gitdir/MERGE_HEAD" ] && return 0
  [ -d "$gitdir/rebase-merge" ] && return 0
  [ -d "$gitdir/rebase-apply" ] && return 0
  return 1
}

# pr_state <branch> -- prints "none", or "state armed queued" (armed and
# queued are "1"/"0"); prints "unknown" when gh/jq is unavailable.
pr_state() {
  local branch="$1" json state armed num queued="0"
  if [ "$has_gh" -eq 0 ] || [ "$has_jq" -eq 0 ] || [ -z "$repo_slug" ]; then
    echo "unknown"
    return
  fi
  json="$(gh pr list --repo "$repo_slug" --head "$branch" --state all --json number,state,autoMergeRequest --limit 1 2>/dev/null)"
  [ -z "$json" ] || [ "$json" = "[]" ] && { echo "none"; return; }
  state="$(echo "$json" | jq -r '.[0].state')"
  num="$(echo "$json" | jq -r '.[0].number')"
  armed="0"
  [ "$(echo "$json" | jq -r '.[0].autoMergeRequest')" != "null" ] && armed="1"
  if [ "$state" = "OPEN" ] && [ "$armed" = "0" ]; then
    local mq
    mq="$(gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){mergeQueueEntry{id}}}}' \
      -f o="${repo_slug%%/*}" -f r="${repo_slug##*/}" -F n="$num" 2>/dev/null | jq -r '.data.repository.pullRequest.mergeQueueEntry.id // empty')"
    [ -n "$mq" ] && queued="1"
  fi
  echo "$state $armed $queued"
}

git worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r wt; do
  [ "$wt" = "$main_worktree" ] && continue
  [ -d "$wt" ] || continue

  branch="$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"  # git-isolation:allow -- real worktree list, not a fixture; local git env vars are cleared above

  if worktree_busy "$wt"; then
    echo "SKIP  $wt (branch $branch): a live process is using it"
    continue
  fi
  if branch_unpushed "$wt" "$branch"; then
    echo "SKIP  $wt (branch $branch): unpushed commits (or no upstream to verify against)"
    continue
  fi
  if tree_dirty_or_mid_merge "$wt"; then
    echo "SKIP  $wt (branch $branch): dirty tree or a merge/rebase is in progress"
    continue
  fi

  read -r state armed queued <<<"$(pr_state "$branch")"
  case "$state" in
    unknown)
      echo "SKIP  $wt (branch $branch): gh/jq unavailable, cannot verify PR state"
      ;;
    none|"")
      echo "SKIP  $wt (branch $branch): no PR found for this branch"
      ;;
    MERGED)
      if [ $dry -eq 1 ]; then
        echo "REMOVE $wt (branch $branch): would remove -- PR merged"
      else
        git worktree remove --force "$wt" 2>/dev/null
        git branch -D "$branch" 2>/dev/null
        echo "REMOVE $wt (branch $branch): removed -- PR merged"
      fi
      ;;
    CLOSED)
      if [ $dry -eq 1 ]; then
        echo "REMOVE $wt (branch $branch): would remove -- PR closed"
      else
        git worktree remove --force "$wt" 2>/dev/null
        git branch -D "$branch" 2>/dev/null
        echo "REMOVE $wt (branch $branch): removed -- PR closed"
      fi
      ;;
    OPEN)
      if [ "$armed" = "1" ] || [ "$queued" = "1" ]; then
        echo "SKIP  $wt (branch $branch): PR open and armed or queued -- not yet merged"
      else
        echo "SKIP  $wt (branch $branch): PR open, not armed, not queued"
      fi
      ;;
    *)
      echo "SKIP  $wt (branch $branch): unrecognized PR state '$state'"
      ;;
  esac
done

trim_script="$(dirname "$0")/dev/gocache-trim.sh"
if [ -x "$trim_script" ]; then
  if [ $dry -eq 1 ]; then
    "$trim_script" --dry-run || true
  else
    "$trim_script" || true
  fi
fi

exit 0
