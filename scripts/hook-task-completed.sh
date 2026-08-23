#!/usr/bin/env bash
# TaskCompleted hook (.claude/settings.json): refuses to mark a task
# completed while its branch has unpushed commits, or while its subject
# still reads as an intention rather than an outcome (goal 0176). Scoped
# to task COMPLETION, never commit existence -- a deliberate mid-task WIP
# commit never trips this, because the event only fires when completion
# is claimed. Fails OPEN (exit 0) on any internal error -- a broken hook
# must never brick the session -- and fails CLOSED (exit 2, the
# documented unconditional block for this event) only on the two
# conditions it actually checks.
set -uo pipefail

input="$(cat)"

# Internal-error fail-open: jq missing or stdin unparseable.
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi
if ! echo "$input" | jq -e . >/dev/null 2>&1; then
  exit 0
fi

# `cwd` tracks wherever Claude is actually working (worktree-aware);
# $CLAUDE_PROJECT_DIR stays pinned to the main checkout, so this hook
# must check the branch the session is really on.
cwd="$(echo "$input" | jq -r '.cwd // empty')"
if [ -n "$cwd" ]; then
  cd "$cwd" 2>/dev/null || exit 0
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"

# --- Check 1: unpushed commits on this branch ---
if git rev-parse --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  ahead="$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo "")"
  if echo "$ahead" | grep -qE '^[0-9]+$' && [ "$ahead" -gt 0 ]; then
    echo "Task cannot be marked completed: $ahead unpushed commit(s) on branch '$branch'. Push before completing this task (ADR-0034: push at least once per session)." >&2
    exit 2
  fi
fi
# No upstream configured at all: can't determine push state reliably --
# don't block on this check (fail open on that specific sub-check).

# --- Check 2: subject reads as an intention, not an outcome ---
# Field name isn't pinned down the same way across docs sources, so read
# every plausible candidate and use the first one present.
subject="$(echo "$input" | jq -r '.task_subject // .task_name // .subject // .content // .task_description // empty')"
if [ -n "$subject" ]; then
  first_word="$(echo "$subject" | grep -oE '^[A-Za-z]+' | tr '[:upper:]' '[:lower:]')"
  case "$first_word" in
    build|building|fix|fixing|implement|implementing|investigate|investigating|work|working|add|adding|create|creating|write|writing|update|updating|research|researching|debug|debugging|review|reviewing|refactor|refactoring|test|testing|check|checking|verify|verifying|explore|exploring|design|designing|plan|planning|draft|drafting)
      echo "Task cannot be marked completed: subject '$subject' reads as an intention, not an outcome. Rewrite it to state what shipped (e.g. 'Fixed the race condition', not 'Fix the race condition')." >&2
      exit 2
      ;;
  esac
fi

exit 0
