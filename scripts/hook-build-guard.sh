#!/usr/bin/env bash
# PreToolUse hook (.claude/settings.json, matcher: Bash): refuses the
# install/build/package command family against a dirty working tree
# (goal 0176). Mechanises the CLAUDE.md rule that already states "before
# ANY git write or build in the main checkout, check `git branch
# --show-current` and `git status`" but never enforced it. Deliberately
# narrow: `task dev` (the normal iteration loop, safe on a dirty tree) is
# never matched. Fails OPEN (exit 0) on any internal error -- a broken
# hook must never brick the session -- and fails CLOSED (exit 2, the
# documented unconditional block for PreToolUse) only when the matched
# command is about to run against uncommitted changes.
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

# The gated family: local install/production-build commands only.
gate_re='(^|[[:space:];&|])(task[[:space:]]+install:app|task[[:space:]]+build([[:space:]]|$)|task[[:space:]]+package([[:space:]]|$)|wails3[[:space:]]+build([[:space:]]|$))'
if ! echo "$command_str" | grep -qE "$gate_re"; then
  exit 0
fi

# `cwd` tracks wherever Claude is actually working (worktree-aware);
# $CLAUDE_PROJECT_DIR stays pinned to the main checkout, so this hook
# must check the tree the command would actually build from.
cwd="$(echo "$input" | jq -r '.cwd // empty')"
if [ -n "$cwd" ]; then
  cd "$cwd" 2>/dev/null || exit 0
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

dirty="$(git status --porcelain 2>/dev/null || true)"
if [ -n "$dirty" ]; then
  n="$(echo "$dirty" | grep -c . || true)"
  echo "Blocked: '$command_str' needs a clean working tree -- $n uncommitted change(s) present. Commit or stash before building/installing (CLAUDE.md: check 'git status' before any build)." >&2
  exit 2
fi

exit 0
