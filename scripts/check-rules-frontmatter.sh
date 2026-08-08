#!/usr/bin/env bash
# Validates .claude/rules/*.md frontmatter against Claude Code's actual
# documented schema (code.claude.com/docs/en/memory.md): the only valid
# top-level key is `paths`, a YAML list of glob strings; a rule with no
# frontmatter at all is also valid (loads unconditionally). Run by
# lefthook (pre-commit) and CI's rules-frontmatter job, same "one script,
# not two copies that can drift" shape as check-loc.sh.
#
# Exists because of a real bug, not speculatively: .claude/rules/
# frontend.md shipped for a while with a `globs:` key instead of `paths:`,
# sourced from a stale GitHub issue rather than the official docs -- the
# rule's path-scoping silently never worked as intended, and nothing
# caught it. No existing tool covers this (checked: cclint validates
# agents/commands/settings.json/CLAUDE.md, not .claude/rules/*.md), so
# this is a small hand-rolled check, not a reinvention of one that
# already existed.
set -euo pipefail

rules_dir=".claude/rules"
violations=0

[[ -d "$rules_dir" ]] || exit 0

while IFS= read -r -d '' file; do
  # No frontmatter at all is valid -- an unscoped rule loads every
  # session, same priority as CLAUDE.md.
  first_line=$(head -n1 "$file")
  [[ "$first_line" == "---" ]] || continue

  # Extract the block between the first two `---` delimiters.
  frontmatter=$(awk 'NR==1{next} /^---$/{exit} {print}' "$file")

  # Every top-level (non-indented) key in that block must be `paths:`.
  # A list-item line (`  - "..."`) is indented and skipped here on
  # purpose -- only keys are checked, not paths's own values.
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^[[:space:]] ]] && continue # indented -- a list item, not a key
    if [[ ! "$line" =~ ^paths: ]]; then
      key="${line%%:*}"
      echo "  $file: unknown frontmatter key \"$key\" -- only \"paths\" is valid (Claude Code rules don't support \"globs\" or any other key)"
      violations=$((violations + 1))
    fi
  done <<<"$frontmatter"
done < <(find "$rules_dir" -name '*.md' -print0)

if ((violations > 0)); then
  echo "error: $violations invalid .claude/rules/*.md frontmatter key(s) -- see code.claude.com/docs/en/memory.md for the real schema." >&2
  exit 1
fi
