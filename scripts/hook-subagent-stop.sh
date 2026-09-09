#!/usr/bin/env bash
# SubagentStop hook (.claude/settings.json): refuses a subagent's stop
# turn while its goal-branch worktree still has uncommitted changes --
# the class fix for a builder that repeatedly hit its turn cap with a
# finished, uncommitted diff (goal 0414 S3; AGENT-LEDGER.md 2026-09-09:
# 0396, 0349 S2b, 0408 S3, 0380, each costing a land-only resume even
# with the checkpoint rule stated verbatim in the dispatch prompt).
#
# Claude Code's SubagentStop payload (read on stdin below) carries
# session_id/transcript_path/cwd in the general Stop-event shape but no
# field naming the stopping subagent's own worktree path, so this hook
# cannot address one worktree by identity. It approximates instead:
# scan every git worktree under /Users/ali/code/mill-wt-* whose branch
# starts with `goal/`, and treat one that has BOTH a non-empty `git
# status --porcelain` AND a file touched within the last 30 minutes as
# the one that just stopped. This is a documented approximation, not a
# precise match -- replace the scan with a direct lookup the moment the
# event starts delivering a worktree/cwd field for the subagent itself.
# Fields read from stdin: session_id, cwd -- parsed for a future direct
# match; neither is load-bearing to the check below today.
#
# Fails OPEN (exit 0) on internal error (jq missing, empty/unparseable
# stdin, no matching worktree) and fails CLOSED (exit 2, the documented
# unconditional block for this event) only on the one condition it
# actually checks -- same fail-open/fail-closed split as
# hook-task-completed.sh.
set -uo pipefail

input="$(cat)"
session_id=""
cwd_field=""
if command -v jq >/dev/null 2>&1; then
  session_id="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)"
  cwd_field="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)"
fi
: "$session_id" "$cwd_field" # read for future direct-match targeting only

worktree_glob="${MILL_SUBAGENT_STOP_WORKTREE_GLOB:-/Users/ali/code/mill-wt-*}"
stale_minutes="${MILL_SUBAGENT_STOP_STALE_MINUTES:-30}"

for wt in $worktree_glob; do
  [ -e "$wt/.git" ] || continue

  branch="$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")" # git-isolation:allow -- read-only query against a REAL builder worktree, never a throwaway fixture
  case "$branch" in
    goal/*) ;;
    *) continue ;;
  esac

  status="$(git -C "$wt" status --porcelain 2>/dev/null || echo "")" # git-isolation:allow -- read-only query against a REAL builder worktree, never a throwaway fixture
  [ -n "$status" ] || continue

  newest="$(find "$wt" -type f -not -path '*/.git/*' -mmin -"$stale_minutes" -print -quit 2>/dev/null)"
  [ -n "$newest" ] || continue

  count="$(printf '%s\n' "$status" | grep -c .)"
  echo "builder stopping with $count uncommitted files on $branch: commit them as wip: first" >&2
  exit 2
done

exit 0
