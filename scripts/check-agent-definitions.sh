#!/usr/bin/env bash
# Enforces goal 0414 S1: every `.claude/agents/*.md` definition carries
# the frontmatter Claude Code's own sub-agent contract needs to run it
# unattended (name/description/model/maxTurns), and the four
# dispatch-owning agents (builder, pr-shepherd, closeout, verifier)
# carry the specific operational commitments this goal moved OUT of
# every brief and INTO the agent body -- so a body edit that silently
# drops one of them (PR-merge ownership, the bounded-wait timeout, the
# blocked-action escalation rule) fails the build instead of surfacing
# as a live incident later. Run by lefthook (pre-commit) and CI's
# agent-definitions job -- one script both call, same non-drift shape
# as check-comment-hygiene.sh.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

agents_dir=".claude/agents"
violations=0

# The exact sentence every dispatch-owning agent must carry verbatim
# (goal 0414 S1 amendment): a permission/classifier block is escalated,
# never routed around via a different tool.
blocked_action_sentinel='A permission-blocked or classifier-blocked action is reported to the orchestrator, never worked around by another route'

# A required phrase can wrap across a markdown line break in the body
# prose, so both matchers check against the file with newlines folded
# to single spaces, never a per-line grep.
require_fixed() {
  local file="$1" pattern="$2" label="$3"
  if ! tr '\n' ' ' <"$file" | tr -s ' ' | grep -qiF "$pattern"; then
    echo "agent-definitions: $file: missing required phrase -- $label"
    violations=$((violations + 1))
  fi
}

require_regex() {
  local file="$1" pattern="$2" label="$3"
  if ! tr '\n' ' ' <"$file" | tr -s ' ' | grep -qiE "$pattern"; then
    echo "agent-definitions: $file: missing required phrase -- $label"
    violations=$((violations + 1))
  fi
}

while IFS= read -r -d '' file; do
  base="$(basename "$file")"
  # README.md is the stable-registry index, not an agent definition --
  # it carries no frontmatter by design.
  [[ "$base" == "README.md" ]] && continue

  first_line=$(head -n1 "$file")
  if [[ "$first_line" != "---" ]]; then
    echo "agent-definitions: $file: no frontmatter block"
    violations=$((violations + 1))
    continue
  fi
  frontmatter=$(awk '/^---$/{c++; next} c==1' "$file")

  for key in name description model maxTurns; do
    if ! grep -qE "^${key}:" <<<"$frontmatter"; then
      echo "agent-definitions: $file: frontmatter missing '$key:'"
      violations=$((violations + 1))
    fi
  done

  case "$base" in
    builder.md)
      require_fixed "$file" 'own the PR to merge' "own the PR to merge"
      require_regex "$file" 'timeout:? *600000' "timeout 600000"
      require_fixed "$file" "$blocked_action_sentinel" "blocked-action sentinel"
      ;;
    pr-shepherd.md)
      require_fixed "$file" 'never rebase + force-push' "never rebase + force-push"
      require_fixed "$file" "$blocked_action_sentinel" "blocked-action sentinel"
      ;;
    closeout.md)
      require_fixed "$file" 'single-writer' "docs-repo single-writer rules"
      require_fixed "$file" "$blocked_action_sentinel" "blocked-action sentinel"
      ;;
    verifier.md)
      require_fixed "$file" 'state matrix' "installed-app state-matrix pass"
      require_fixed "$file" "$blocked_action_sentinel" "blocked-action sentinel"
      ;;
  esac
done < <(find "$agents_dir" -maxdepth 1 -name '*.md' -print0 | sort -z)

if ((violations > 0)); then
  echo "error: $violations agent-definition violation(s) -- see .claude/agents/README.md and goal 0414" >&2
  exit 1
fi

echo "agent-definitions: ok"
