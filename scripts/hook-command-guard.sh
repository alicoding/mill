#!/usr/bin/env bash
# PreToolUse hook (.claude/settings.json, matcher: Bash): denies the
# two command families this repo's rules mark never-granted, after
# each cost a real incident (docs/goals/0191's evidence bar -- no hook
# for a problem that hasn't occurred):
#   - `pkill -f` / `killall`: a broad pkill once took down the
#     production mill-server LaunchAgent; kills must target own PIDs
#     or lsof-resolved ports.
#   - `git push --force[-with-lease]` / `-f` and history-rewrite
#     plumbing (filter-branch/filter-repo): never granted (CLAUDE.md).
#     `commit --amend` and plain `git rebase` stay JUDGEMENT, not
#     hooks: both are legitimate when explicitly asked (the rule's own
#     wording), and the pr-shepherd's instructed rebases are a
#     standing legal flow -- a hook cannot see "was asked".
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

if echo "$command_str" | grep -qE "${seg}git[[:space:]]+(filter-branch|filter-repo)([[:space:]]|$)"; then
  echo "Blocked: history rewrites are never granted in this repo (CLAUDE.md)." >&2
  exit 2
fi

exit 0
