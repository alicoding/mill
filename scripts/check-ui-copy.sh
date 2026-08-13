#!/usr/bin/env bash
# Enforces .claude/rules/ux-writing.md's objective leak class: UI copy
# (locale JSON) must never reference internal documents -- docs/ paths,
# ADR ids, goal-file ids, or section symbols mean nothing to a reader
# inside the app. Run by lefthook (pre-commit) and CI's ui-copy job --
# one script both call, same non-drift shape as check-loc.sh.
# Voice/length rules stay review-checked (see the rule file); this
# gate covers only what a grep can assert without false authority.
set -euo pipefail

pattern='docs/(adr|goals|SPEC)|ADR-[0-9]|goal [0-9]{4}|§'

violations=0
while IFS= read -r -d '' file; do
  hits="$(grep -nE "$pattern" "$file" || true)"
  if [[ -n "$hits" ]]; then
    while IFS= read -r hit; do
      echo "ui-copy: $file:$hit"
      violations=$((violations + 1))
    done <<< "$hits"
  fi
done < <(git ls-files -z -- 'frontend/src/locales/*.json')

if [[ "$violations" -gt 0 ]]; then
  echo
  echo "ui-copy: $violations violation(s). UI copy states behavior in the"
  echo "user's vocabulary -- internal doc references belong in docs/, not"
  echo "in strings the app renders. See .claude/rules/ux-writing.md."
  exit 1
fi
