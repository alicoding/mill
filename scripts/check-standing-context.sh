#!/usr/bin/env bash
# Enforces the standing-context budget (goal 0325): CLAUDE.md and every
# unconditional rule (a .claude/rules/*.md file with no `paths:`
# frontmatter key -- see check-rules-frontmatter.sh's own detection of
# that key) load into EVERY session, so their size is a permanent
# per-turn tax, not a one-time read. Run by lefthook (pre-commit) and
# CI's standing-context job, one script both call.
set -euo pipefail

claude_md="CLAUDE.md"
claude_md_limit=200
rules_dir=".claude/rules"
rules_word_limit=3000

violations=0

if [[ -f "$claude_md" ]]; then
  claude_md_lines=$(wc -l <"$claude_md" | tr -d '[:space:]')
  echo "standing-context: $claude_md is $claude_md_lines lines (limit $claude_md_limit)"
  if ((claude_md_lines > claude_md_limit)); then
    echo "error: $claude_md is $claude_md_lines lines, over the $claude_md_limit-line budget" >&2
    violations=$((violations + 1))
  fi
fi

if [[ ! -f AGENTS.md ]]; then
  echo "error: AGENTS.md context router is missing" >&2
  violations=$((violations + 1))
else
  agents_lines=$(wc -l <AGENTS.md | tr -d '[:space:]')
  agents_words=$(wc -w <AGENTS.md | tr -d '[:space:]')
  echo "standing-context: AGENTS.md overhead is $agents_lines lines / $agents_words words (limits 120 / 1500)"
  if ((agents_lines > 120 || agents_words > 1500)); then
    echo "error: AGENTS.md exceeds its separate routing overhead budget" >&2
    violations=$((violations + 1))
  fi
fi

total_words=0
if [[ -d "$rules_dir" ]]; then
  while IFS= read -r -d '' file; do
    # A rule with a `paths:` frontmatter key loads only for matching
    # files, not every session -- it's outside the standing budget.
    # No frontmatter at all (or frontmatter without `paths:`) loads
    # unconditionally, same as CLAUDE.md.
    if grep -q '^paths:' "$file"; then
      continue
    fi
    words=$(wc -w <"$file" | tr -d '[:space:]')
    echo "standing-context: $file is $words words (unconditional)"
    total_words=$((total_words + words))
  done < <(find "$rules_dir" -maxdepth 1 -name '*.md' -print0 | sort -z)
fi

echo "standing-context: unconditional .claude/rules/*.md total is $total_words words (limit $rules_word_limit)"
if ((total_words > rules_word_limit)); then
  echo "error: unconditional .claude/rules/*.md total is $total_words words, over the $rules_word_limit-word budget" >&2
  violations=$((violations + 1))
fi

if ((violations > 0)); then
  echo "error: $violations standing-context budget violation(s) -- see CLAUDE.md's standing-context-budget note and docs/adr/0050-orchestration-model.md." >&2
  exit 1
fi
