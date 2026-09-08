#!/usr/bin/env bash
# PreToolUse hook (.claude/settings.json, matcher: Bash): denies the
# command families this repo's rules mark never-granted for an agent's
# own Bash calls, after each cost a real incident (docs/goals/0191's
# evidence bar -- no hook for a problem that hasn't occurred):
#   - `pkill -f` / `killall`: a broad pkill once took down the
#     production mill-server LaunchAgent; kills must target own PIDs
#     or lsof-resolved ports.
#   - `git push --force[-with-lease]` / `-f` and history-rewrite
#     plumbing (filter-branch/filter-repo): never granted (CLAUDE.md).
#   - `git stash`: it dropped a MERGE_HEAD mid-merge (goal 0339);
#     commit first, resolve in place.
#   - `git checkout <anything> -- <path>` (the `--` pathspec form): it
#     resolved against a moving ref and destroyed a builder's edits in
#     a live worktree. Plain `git checkout <branch>` / `-b` stay
#     allowed -- only the pathspec form is denied.
#   - `go clean -cache` / any `go clean` invocation carrying a
#     `-cache` flag: it broke other agents' concurrent compiles
#     sharing the build cache. `go clean -testcache` alone is
#     unaffected and stays allowed.
#   - `git add -A` / `git add --all`: stages everything in the tree,
#     including files an agent didn't intend to touch (CLAUDE.md: add
#     specific files by name).
#   - `git commit --amend`: this repo creates new commits, never
#     amends (CLAUDE.md, `feedback_git_hygiene`).
#   - `git rebase` (any subcommand): goal 0403 S2's dispatch contract.
#     This denies rebase for every Bash call this hook sees, the
#     pr-shepherd's included; a rebase step now needs a human running
#     it outside the hook's reach, or a scoped hook exception added
#     when that need is confirmed.
# Patterns are anchored to a command-segment start (after ^ ; & |) so
# a commit message or echoed string MENTIONING these words is never a
# false positive -- false negatives are acceptable here, a wrongly
# blocked session is not. Fails OPEN (exit 0) on any internal error,
# same contract as hook-build-guard.sh; exit 2 is the documented
# unconditional PreToolUse deny.
set -uo pipefail

input="$(cat)"

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi
if ! echo "$input" | jq -e . >/dev/null 2>&1; then
  exit 0
fi

tool_name="$(echo "$input" | jq -r '.tool_name // empty')"
if [ "$tool_name" != "Bash" ]; then
  exit 0
fi

command_str="$(echo "$input" | jq -r '.tool_input.command // empty')"
if [ -z "$command_str" ]; then
  exit 0
fi

seg='(^|[;&|][[:space:]]*|&&[[:space:]]*|\|\|[[:space:]]*)(sudo[[:space:]]+)?'

if echo "$command_str" | grep -qE "${seg}pkill([[:space:]]+[^;&|[:space:]]+)*[[:space:]]+-[a-zA-Z]*f"; then
  echo "Blocked: pkill -f is never allowed here (a broad pkill once killed the production mill-server). Kill only your own PIDs, or resolve the port with lsof -ti and kill that PID." >&2
  exit 2
fi

if echo "$command_str" | grep -qE "${seg}killall([[:space:]]|$)"; then
  echo "Blocked: killall is never allowed here (same incident class as pkill -f). Kill only your own PIDs, or resolve the port with lsof -ti and kill that PID." >&2
  exit 2
fi

if echo "$command_str" | grep -qE "${seg}git[[:space:]]+push([[:space:]]+[^;&|[:space:]]+)*[[:space:]]+(--force(-with-lease)?|-f)([[:space:]]|$)"; then
  echo "Blocked: force-push is never granted in this repo (CLAUDE.md). Fix forward with a new commit instead." >&2
  exit 2
fi

if echo "$command_str" | grep -qE "${seg}git[[:space:]]+stash([[:space:]]|$)"; then
  echo "Blocked: git stash is never allowed here (it dropped a MERGE_HEAD mid-merge in a prior incident). Commit first, then resolve in place." >&2
  exit 2
fi

if echo "$command_str" | grep -qE "${seg}git[[:space:]]+checkout[^;&|]*[[:space:]]--([[:space:]]|$)"; then
  echo "Blocked: git checkout <ref> -- <path> is never allowed here (it resolved against a moving ref and destroyed a builder's edits). Never touch another worktree's files this way." >&2
  exit 2
fi

if echo "$command_str" | grep -qE "${seg}go[[:space:]]+clean([[:space:]]+[^;&|[:space:]]+)*[[:space:]]-cache([[:space:]]|$)"; then
  echo "Blocked: go clean -cache is never allowed here (it broke other agents' concurrent compiles sharing the build cache). go clean -testcache alone is fine." >&2
  exit 2
fi

if echo "$command_str" | grep -qE "${seg}git[[:space:]]+add([[:space:]]+[^;&|[:space:]]+)*[[:space:]](-A|--all)([[:space:]]|$)"; then
  echo "Blocked: git add -A/--all is never allowed here (CLAUDE.md: stage specific files by name, never the whole tree)." >&2
  exit 2
fi

if echo "$command_str" | grep -qE "${seg}git[[:space:]]+commit([[:space:]]+[^;&|[:space:]]+)*[[:space:]]--amend([[:space:]]|$)"; then
  echo "Blocked: git commit --amend is never allowed here (this repo always creates a new commit, never rewrites the last one)." >&2
  exit 2
fi

if echo "$command_str" | grep -qE "${seg}git[[:space:]]+rebase([[:space:]]|$)"; then
  echo "Blocked: git rebase is never allowed here. Merge origin/main in, or fix forward with a new commit, instead." >&2
  exit 2
fi

# Gate commands (commits through lefthook, test suites, installs) run in the
# foreground and are polled in place: a backgrounded run's completion
# notification does not reach a subagent, which then stops "waiting" and its
# work is stranded until an orchestrator nudge.
background="$(echo "$input" | jq -r '.tool_input.run_in_background // false')"
if [ "$background" = "true" ] && echo "$command_str" | grep -qE "(^|[[:space:]&|;])(git[[:space:]]+commit|lefthook|npx[[:space:]]+playwright|playwright[[:space:]]+test|go[[:space:]]+test|vitest|npm[[:space:]]+(ci|install|test)|task[[:space:]]+(build|package|install:app))([[:space:]]|$)"; then
  echo "Blocked: gate commands never run in the background here (the completion notification is lost to a subagent). Run it in the foreground with timeout up to 600000 and poll its output with a bounded sleep loop in the next call." >&2
  exit 2
fi

if echo "$command_str" | grep -qE "${seg}git[[:space:]]+(filter-branch|filter-repo)([[:space:]]|$)"; then
  echo "Blocked: history rewrites are never granted in this repo (CLAUDE.md)." >&2
  exit 2
fi

exit 0
