#!/usr/bin/env bash
# Enforces .claude/rules/comments.md: source comments state constraints,
# never decision provenance (owner quotes, session stories, calendar
# dates). Run by lefthook (pre-commit) and CI's comment-hygiene job --
# one script both call, same non-drift shape as check-loc.sh.
set -euo pipefail

# Same hand-written-source scope as check-loc.sh: generated bindings,
# the vendored gomobile scaffold, and build artifacts are not Mill's
# own prose to police.
exclude_regex='^(frontend/bindings/|build/ios/|build/android/|frontend/dist/|frontend/node_modules/)'

# Provenance phrases are banned anywhere in a source file -- if one
# shows up in a string literal it is just as much shipped narrative as
# it is in a comment. Case-insensitive.
phrases='direct user decision|owner-directed|owner-ratified|owner-mandated|owner call|user asked|the owner|caught live|found live|this session|last session'

# Calendar dates are banned on comment lines only: dates inside code
# and string literals (test fixtures, formats) are legitimate data.
date_in_comment='(//|^[[:space:]]*\*|/\*).*20[0-9]{2}-[0-9]{2}-[0-9]{2}'

allow_marker='comment-hygiene:allow'

violations=0
while IFS= read -r -d '' file; do
  case "$file" in
    *.go|*.ts|*.tsx) ;;
    *) continue ;;
  esac
  if [[ "$file" =~ $exclude_regex ]]; then
    continue
  fi
  hits="$( { grep -inE "$phrases" "$file" || true; grep -nE "$date_in_comment" "$file" || true; } | grep -v "$allow_marker" || true)"
  if [[ -n "$hits" ]]; then
    while IFS= read -r hit; do
      echo "comment-hygiene: $file:$hit"
      violations=$((violations + 1))
    done <<< "$hits"
  fi
done < <(git ls-files -z -- '*.go' '*.ts' '*.tsx')

if [[ "$violations" -gt 0 ]]; then
  echo
  echo "comment-hygiene: $violations violation(s). Comments state constraints;"
  echo "decision provenance lives in docs/SPEC.md, docs/adr/, docs/goals/ --"
  echo "cite by id instead. See .claude/rules/comments.md."
  exit 1
fi
