#!/usr/bin/env bash
# Enforces goal 0333: drag regions are opt-in. frontend/src/app/index.css
# sets --wails-draggable: no-drag on body, so the window drags nowhere by
# default; only a surface that deliberately sets the property to "drag"
# opts the window into moving from a pointer press there. Also enforces
# goal 0385's cross-check: a `Frameless: true` window construction in Go
# is easy to ship with NOTHING deciding whether it drags -- no gate
# flagged that absence until this one (the 0377-shaped gap). Every such
# window must appear in the frameless_disposition table below, either
# "drag:<allowlisted CSS file>" (cross-checked against the pattern scan)
# or "no-drag:<reason>" for a deliberately fixed-position surface. Run by
# lefthook (pre-commit) and CI's drag-regions job -- one script both
# call, same non-drift shape as check-loc.sh/check-ui-copy.sh.
set -euo pipefail

# Matches an actual assignment of the literal value "drag" -- never
# "no-drag" (the intervening "no-" breaks each pattern's match) -- across
# CSS custom-property declarations, JS/TS setProperty() calls, and inline
# style object literals.
pattern='--wails-draggable[[:space:]]*:[[:space:]]*drag[[:space:]]*;'
pattern+='|setProperty\([[:space:]]*['"'"'"]--wails-draggable['"'"'"][[:space:]]*,[[:space:]]*['"'"'"]drag['"'"'"]'
pattern+='|['"'"'"]--wails-draggable['"'"'"][[:space:]]*:[[:space:]]*['"'"'"]drag['"'"'"]'

# Parallel indexed arrays, not an associative array (bash 3.2 --
# GitHub's macOS runner's own /bin/bash -- has none): allowlist_files[i]
# pairs with allowlist_limits[i], looked up by allowlist_limit_for below.
allowlist_files=(
  "frontend/src/app/App.module.css"
  "frontend/src/app/RunMonitor.module.css"
  # The Quick Panel's facet-chip row + search-input header (goal 0377):
  # a frameless window's only drag handle, same RunMonitor.module.css
  # shape.
  "frontend/src/app/QuickPanel.module.css"
)
allowlist_limits=(1 1 1)

# allowlist_limit_for <file>: prints the allowed --wails-draggable: drag
# occurrence count for <file>, or 0 when it's not in allowlist_files.
allowlist_limit_for() {
  local needle="$1" i
  for i in "${!allowlist_files[@]}"; do
    if [[ "${allowlist_files[$i]}" == "$needle" ]]; then
      echo "${allowlist_limits[$i]}"
      return
    fi
  done
  echo 0
}

violations=0
while IFS= read -r -d '' file; do
  case "$file" in
    *.css | *.ts | *.tsx) ;;
    *) continue ;;
  esac
  hits="$(grep -nE -- "$pattern" "$file" || true)"
  [[ -z "$hits" ]] && continue

  count="$(grep -cE -- "$pattern" "$file")"
  limit="$(allowlist_limit_for "$file")"
  if (( limit == 0 )) || (( count > limit )); then
    while IFS= read -r hit; do
      echo "drag-regions: $file:$hit"
      violations=$((violations + 1))
    done <<< "$hits"
  fi
done < <(git ls-files -z -- 'frontend/src')

# Every frameless window's own disposition, decided once and recorded
# here -- a new Frameless: true window absent from this table fails
# instead of silently shipping unconsidered (goal 0385).
# Same parallel-indexed-array shape as allowlist_files/allowlist_limits
# above, for the same bash-3.2 reason.
frameless_disposition_names=(quickpanel approvalprompt traypanel)
frameless_disposition_values=(
  "no-drag:centered via WindowCentered and dismissed by losing focus/Escape, never dragged today"
  "no-drag:a transient decision prompt, centered and dismissed by an explicit answer or Escape, never repositioned"
  "no-drag:anchored to the tray icon's own PositionWindow; dragging it away would misplace its anchor"
)

# frameless_disposition_for <window>: prints the recorded disposition
# for <window>, or nothing when it has none yet.
frameless_disposition_for() {
  local needle="$1" i
  for i in "${!frameless_disposition_names[@]}"; do
    if [[ "${frameless_disposition_names[$i]}" == "$needle" ]]; then
      echo "${frameless_disposition_values[$i]}"
      return
    fi
  done
}

# extract_frameless_window_names <go-file>: prints the Name of every
# application.WebviewWindowOptions{...} literal in the file that also
# sets Frameless: true. Depth-tracked per-line brace counting (not a
# full parser) is enough because each literal here is well-formed Go
# source, never split across a string containing a literal brace.
extract_frameless_window_names() {
  local file="$1" inblock=0 depth=0 name="" frameless=0 line opens closes
  while IFS= read -r line; do
    if [[ "$inblock" -eq 0 && "$line" == *"WebviewWindowOptions{"* ]]; then
      inblock=1
      depth=0
      name=""
      frameless=0
    fi
    if [[ "$inblock" -eq 1 ]]; then
      opens="${line//[^\{]/}"
      closes="${line//[^\}]/}"
      depth=$((depth + ${#opens} - ${#closes}))
      if [[ "$line" =~ Name:[[:space:]]*\"([A-Za-z0-9_]+)\" ]]; then
        name="${BASH_REMATCH[1]}"
      fi
      if [[ "$line" =~ Frameless:[[:space:]]*true ]]; then
        frameless=1
      fi
      if ((depth <= 0)); then
        if [[ "$frameless" -eq 1 ]]; then
          echo "$name"
        fi
        inblock=0
      fi
    fi
  done <"$file"
}

while IFS= read -r -d '' file; do
  case "$file" in
    *_test.go) continue ;;
    *.go) ;;
    *) continue ;;
  esac
  while IFS= read -r window; do
    [[ -z "$window" ]] && continue
    disposition="$(frameless_disposition_for "$window")"
    if [[ -z "$disposition" ]]; then
      echo "drag-regions: $file: Frameless window \"$window\" has no drag disposition -- add it to frameless_disposition in scripts/check-drag-regions.sh (drag:<css file> or no-drag:<reason>)"
      violations=$((violations + 1))
      continue
    fi
    case "$disposition" in
      drag:*)
        css_file="${disposition#drag:}"
        if [[ "$(allowlist_limit_for "$css_file")" -lt 1 ]]; then
          echo "drag-regions: $file: window \"$window\" names $css_file but it is not in the drag-region allowlist"
          violations=$((violations + 1))
        elif ! grep -qE -- "$pattern" "$css_file"; then
          echo "drag-regions: $file: window \"$window\" names $css_file but it declares no --wails-draggable: drag"
          violations=$((violations + 1))
        fi
        ;;
      no-drag:*) ;;
      *)
        echo "drag-regions: $file: window \"$window\" has a malformed disposition \"$disposition\""
        violations=$((violations + 1))
        ;;
    esac
  done < <(extract_frameless_window_names "$file")
done < <(git ls-files -z -- '*.go')

if [[ "$violations" -gt 0 ]]; then
  echo
  echo "drag-regions: $violations violation(s). Drag regions are opt-in --"
  echo "only frontend/src/app/App.module.css's titlebar band,"
  echo "RunMonitor.module.css's header, and QuickPanel.module.css's"
  echo "facet-chip/search-input header may set --wails-draggable: drag."
  echo "See goal 0333, .claude/rules/architecture.md."
  exit 1
fi
