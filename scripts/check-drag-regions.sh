#!/usr/bin/env bash
# Enforces goal 0333: drag regions are opt-in. frontend/src/app/index.css
# sets --wails-draggable: no-drag on body, so the window drags nowhere by
# default; only a surface that deliberately sets the property to "drag"
# opts the window into moving from a pointer press there. Run by lefthook
# (pre-commit) and CI's drag-regions job -- one script both call, same
# non-drift shape as check-loc.sh/check-ui-copy.sh.
set -euo pipefail

# Matches an actual assignment of the literal value "drag" -- never
# "no-drag" (the intervening "no-" breaks each pattern's match) -- across
# CSS custom-property declarations, JS/TS setProperty() calls, and inline
# style object literals.
pattern='--wails-draggable[[:space:]]*:[[:space:]]*drag[[:space:]]*;'
pattern+='|setProperty\([[:space:]]*['"'"'"]--wails-draggable['"'"'"][[:space:]]*,[[:space:]]*['"'"'"]drag['"'"'"]'
pattern+='|['"'"'"]--wails-draggable['"'"'"][[:space:]]*:[[:space:]]*['"'"'"]drag['"'"'"]'

declare -A allowlist=(
  ["frontend/src/app/App.module.css"]=1
  ["frontend/src/app/RunMonitor.module.css"]=1
)

violations=0
while IFS= read -r -d '' file; do
  case "$file" in
    *.css | *.ts | *.tsx) ;;
    *) continue ;;
  esac
  hits="$(grep -nE -- "$pattern" "$file" || true)"
  [[ -z "$hits" ]] && continue

  count="$(grep -cE -- "$pattern" "$file")"
  limit="${allowlist[$file]:-0}"
  if (( limit == 0 )) || (( count > limit )); then
    while IFS= read -r hit; do
      echo "drag-regions: $file:$hit"
      violations=$((violations + 1))
    done <<< "$hits"
  fi
done < <(git ls-files -z -- 'frontend/src')

if [[ "$violations" -gt 0 ]]; then
  echo
  echo "drag-regions: $violations violation(s). Drag regions are opt-in --"
  echo "only frontend/src/app/App.module.css's titlebar band and"
  echo "frontend/src/app/RunMonitor.module.css's header may set"
  echo "--wails-draggable: drag. See goal 0333, .claude/rules/architecture.md."
  exit 1
fi
