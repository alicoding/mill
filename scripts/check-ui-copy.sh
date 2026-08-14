#!/usr/bin/env bash
# Enforces .claude/rules/ux-writing.md's objective leak class: UI copy
# (locale JSON, seeded workflow descriptions) must never reference
# internal documents -- docs/ paths, ADR ids, goal-file ids, or section
# symbols mean nothing to a reader inside the app. Run by lefthook
# (pre-commit) and CI's ui-copy job -- one script both call, same
# non-drift shape as check-loc.sh.
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

# Seeded entity descriptions render straight into the app the same as
# locale strings do (workflow seeds into the palette/canvas, list and
# HTTP-request seeds into Configure), so they carry the same
# no-internal-docs bar. Scoped to lines that actually declare a
# Description (rather than the whole file) so this doesn't flag the
# packages' own doc-citing comments, which are legitimate.
while IFS= read -r -d '' file; do
  hits="$(grep -nE 'Description:' "$file" | grep -E "$pattern" || true)"
  if [[ -n "$hits" ]]; then
    while IFS= read -r hit; do
      echo "ui-copy: $file:$hit"
      violations=$((violations + 1))
    done <<< "$hits"
  fi
done < <(git ls-files -z -- 'internal/domain/composition/builtinworkflows*.go' 'internal/domain/list/builtin.go' 'internal/domain/httprequest/builtin.go')

if [[ "$violations" -gt 0 ]]; then
  echo
  echo "ui-copy: $violations violation(s). UI copy states behavior in the"
  echo "user's vocabulary -- internal doc references belong in docs/, not"
  echo "in strings the app renders. See .claude/rules/ux-writing.md."
  exit 1
fi
