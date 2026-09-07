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
  # The Quick Panel's facet-chip row + search-input header (goal 0377):
  # a frameless window's only drag handle, same RunMonitor.module.css
  # shape.
  ["frontend/src/app/QuickPanel.module.css"]=1
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
  echo "only frontend/src/app/App.module.css's titlebar band,"
  echo "RunMonitor.module.css's header, and QuickPanel.module.css's"
  echo "facet-chip/search-input header may set --wails-draggable: drag."
  echo "See goal 0333, .claude/rules/architecture.md."
  exit 1
fi
