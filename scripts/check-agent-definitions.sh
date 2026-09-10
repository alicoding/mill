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

# goal 0414 S2 sentinels: fixed phrases each fix moved into the
# relevant agent body, checked here instead of trusted to survive a
# future edit unnoticed.
subagent_allow_sentinel='only sub-agents you may spawn are reviewer, explorer, research'
subagent_never_sentinel='never `fork`, never `general-purpose`'
readonly_bash_sentinel='is for read-only commands only'
review_report_script_sentinel='scripts/check-review-report.sh'
review_report_ok_sentinel='review-report: ok'
poll_forbidden_sentinel='Poll loops are forbidden past this point'
pgrep_own_shell_sentinel="excludes the caller's own shell"
worktree_busy_sentinel='names the holding process'
budget_cumulative_sentinel='CUMULATIVE across resumes'
budget_resume_cap_sentinel='at most two resumes per brief'
closeout_batch_sentinel='at most 3 merged PRs per batch'

# goal 0414 S3/S4 sentinels: the checkpoint-commit rule this goal moved
# out of every dispatch prompt (a prompt-level rule did not survive 120
# turns of context) and into builder.md whole, pr-shepherd.md rule d
# only. S4 replaced the fixed turn-80 checkpoint with a ~30-turn
# cadence plus a turn-90 push pre-check.
checkpoint_first_commit_sentinel='the first commit on the goal branch happens the moment'
checkpoint_cadence_sentinel='checkpoint commit happens every ~30 turns'
checkpoint_push_sentinel='at turn ~90 the pre-check pushes the branch'
checkpoint_never_dirty_sentinel='never ends a turn'

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

# maxTurns is a size-class contract (goal 0414 S2, README.md's table) --
# checked against the raw frontmatter block, never the folded whole-file
# text the two helpers above use, since a `^` anchor against a
# single-line fold only ever matches the file's first character.
require_maxturns() {
  local file="$1" frontmatter_text="$2" want="$3"
  if ! grep -qE "^maxTurns: *${want}\$" <<<"$frontmatter_text"; then
    echo "agent-definitions: $file: maxTurns must be $want for its size class (see .claude/agents/README.md)"
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
      require_fixed "$file" "$subagent_allow_sentinel" "read-only sub-agent allowlist"
      require_fixed "$file" "$subagent_never_sentinel" "never fork/general-purpose"
      require_fixed "$file" "$review_report_script_sentinel" "pre-PR check-review-report.sh call"
      require_fixed "$file" "$review_report_ok_sentinel" "review-report: ok gate"
      require_fixed "$file" "$poll_forbidden_sentinel" "poll loops forbidden after arming auto-merge"
      require_fixed "$file" "$pgrep_own_shell_sentinel" "pgrep excludes caller's own shell"
      require_fixed "$file" "$worktree_busy_sentinel" "worktree busy check names the holding process"
      require_fixed "$file" "$budget_cumulative_sentinel" "cumulative budget across resumes"
      require_fixed "$file" "$budget_resume_cap_sentinel" "at most two resumes per brief"
      require_maxturns "$file" "$frontmatter" 120
      require_fixed "$file" "$checkpoint_first_commit_sentinel" "checkpoint-commit rule: first commit once the build is clean"
      require_fixed "$file" "$checkpoint_cadence_sentinel" "checkpoint-commit rule: ~30-turn cadence"
      require_fixed "$file" "$checkpoint_push_sentinel" "checkpoint-commit rule: turn-90 push pre-check"
      require_fixed "$file" "$checkpoint_never_dirty_sentinel" "checkpoint-commit rule: never end a turn with a dirty goal branch"
      ;;
    pr-shepherd.md)
      require_fixed "$file" 'never rebase + force-push' "never rebase + force-push"
      require_fixed "$file" "$blocked_action_sentinel" "blocked-action sentinel"
      require_fixed "$file" "$subagent_allow_sentinel" "read-only sub-agent allowlist"
      require_fixed "$file" "$subagent_never_sentinel" "never fork/general-purpose"
      require_fixed "$file" "$pgrep_own_shell_sentinel" "pgrep excludes caller's own shell"
      require_fixed "$file" "$worktree_busy_sentinel" "worktree busy check names the holding process"
      require_fixed "$file" "$budget_cumulative_sentinel" "cumulative budget across resumes"
      require_fixed "$file" "$budget_resume_cap_sentinel" "at most two resumes per brief"
      require_fixed "$file" "$checkpoint_never_dirty_sentinel" "checkpoint-commit rule d: never end a turn with a dirty goal branch"
      require_maxturns "$file" "$frontmatter" 100
      ;;
    closeout.md)
      require_fixed "$file" 'single-writer' "docs-repo single-writer rules"
      require_fixed "$file" "$blocked_action_sentinel" "blocked-action sentinel"
      require_fixed "$file" "$closeout_batch_sentinel" "batches of at most 3 merged PRs"
      require_fixed "$file" "$budget_cumulative_sentinel" "cumulative budget across resumes"
      require_fixed "$file" "$budget_resume_cap_sentinel" "at most two resumes per brief"
      require_maxturns "$file" "$frontmatter" 40
      ;;
    verifier.md)
      require_fixed "$file" 'state matrix' "installed-app state-matrix pass"
      require_fixed "$file" "$blocked_action_sentinel" "blocked-action sentinel"
      require_fixed "$file" "$subagent_allow_sentinel" "read-only sub-agent allowlist"
      require_fixed "$file" "$subagent_never_sentinel" "never fork/general-purpose"
      require_fixed "$file" "$budget_cumulative_sentinel" "cumulative budget across resumes"
      require_fixed "$file" "$budget_resume_cap_sentinel" "at most two resumes per brief"
      require_maxturns "$file" "$frontmatter" 60
      ;;
    reviewer.md)
      require_fixed "$file" '## Review' "gate-grammar template heading"
      require_regex "$file" '(important|nit|pre-existing) — ' "severity-tagged finding grammar"
      require_fixed "$file" 'Contract match: yes|no —' "Contract match line"
      require_fixed "$file" 'Important findings open:' "Important findings open line"
      require_fixed "$file" "$readonly_bash_sentinel" "explicit read-only Bash line"
      require_maxturns "$file" "$frontmatter" 40
      ;;
    explorer.md|research.md)
      require_fixed "$file" "$readonly_bash_sentinel" "explicit read-only Bash line"
      ;;
  esac
done < <(find "$agents_dir" -maxdepth 1 -name '*.md' -print0 | sort -z)

if ((violations > 0)); then
  echo "error: $violations agent-definition violation(s) -- see .claude/agents/README.md and goal 0414" >&2
  exit 1
fi

echo "agent-definitions: ok"
