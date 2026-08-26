#!/usr/bin/env bash
# Enforces the Atlas toolbar overflow contract (goal 0216, goal 0233):
# every ActionBar.Button/ActionBar.IconButton in AtlasToolbar.tsx or
# AtlasFolderImport.tsx can move into Primer's "More items" overflow
# menu depending on the row's real rendered width, so a spec reaches it
# through fixtures/toolbarActions.ts's openToolbarAction, never a raw
# `getByTestId(id).click()`/`.hover()` chain -- that exact pattern is
# what broke main's CI (a resolved button carrying data-overflowing="",
# "element is not visible" retried to a 60s timeout).
set -euo pipefail

toolbar_src="frontend/src/atlas/AtlasToolbar.tsx"
folder_import_src="frontend/src/atlas/AtlasFolderImport.tsx"
fixture="frontend/e2e/fixtures/toolbarActions.ts"
overflow_spec="frontend/e2e/atlas-toolbar-overflow.spec.ts"

derive_ids() {
  grep -A3 -E "ActionBar\.(Button|IconButton)" "$1" \
    | grep -oE 'data-testid="[a-z0-9-]+"' \
    | sed -E 's/data-testid="([a-z0-9-]+)"/\1/' \
    | sort -u
}

ids="$( { derive_ids "$toolbar_src"; derive_ids "$folder_import_src"; } | sort -u)"

if [[ -z "$ids" ]]; then
  echo "check-toolbar-action-testids: derived zero ids from $toolbar_src / $folder_import_src -- source shape changed, update this script"
  exit 1
fi

# The fixture's own label map must know about every derived id --
# otherwise openToolbarAction's overflow fallback throws "no overflow
# label registered" for an action that can genuinely overflow.
missing=0
while IFS= read -r id; do
  [[ -z "$id" ]] && continue
  if ! grep -q "'$id':" "$fixture"; then
    echo "check-toolbar-action-testids: '$id' has no entry in $fixture's TOOLBAR_ACTION_LABELS"
    missing=$((missing + 1))
  fi
done <<< "$ids"

# No spec outside the fixture/its own dedicated overflow spec may chain
# .click()/.hover() straight onto a toolbar action's raw testid --
# openToolbarAction is the only reachability-safe path.
violations=0
while IFS= read -r -d '' file; do
  case "$file" in
    "$fixture"|"$overflow_spec") continue ;;
  esac
  while IFS= read -r id; do
    [[ -z "$id" ]] && continue
    hits="$(grep -nE "getByTestId\(['\"]${id}['\"]\)\.(click|hover)\(" "$file" || true)"
    if [[ -n "$hits" ]]; then
      while IFS= read -r hit; do
        echo "check-toolbar-action-testids: $file:$hit -- use openToolbarAction(page, '$id') instead"
        violations=$((violations + 1))
      done <<< "$hits"
    fi
  done <<< "$ids"
done < <(git ls-files -z -- 'frontend/e2e/*.spec.ts')

if [[ "$missing" -gt 0 || "$violations" -gt 0 ]]; then
  echo
  echo "check-toolbar-action-testids: $missing missing label(s), $violations direct bypass(es). See frontend/e2e/fixtures/toolbarActions.ts."
  exit 1
fi
