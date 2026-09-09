#!/usr/bin/env bash
# Keeps every Atlas link edge's hover/click routed through
# fixtures/atlasEdge.ts (goal 0358 S8).
#
# The class this exists for: AtlasLinkEdge renders its own chip
# (delete/change-kind buttons) at the edge's bounding-box CENTER --
# labelY + 18 flow units below the line, which shrinks to a couple of
# screen pixels once zoomed out -- the exact point a bare
# edge.hover()/edge.click() targets. Every actionability retry then
# re-intercepts on the chip until the test times out. A position
# computed once and replayed against later retries fares no better:
# the edge's geometry moves under load (a remount reflows the path),
# so a stale offset just moves where it misses. hoverEdgeOffChip/
# clickEdgeOffChip re-resolve the off-chip point INSIDE Playwright's
# own retrying expect(...).toPass() -- the two doors this gate requires.
#
# What this gate flags:
#   A) a `.react-flow__edge` locator chained straight into .hover(/
#      .click( on one statement -- never routed through the fixture.
#   B) a variable this file assigned from a `.react-flow__edge`
#      locator, later called with a bare .hover(/.click( -- the exact
#      shape atlas-slots:173 and atlas-linking:121 recurred as.
#   C) that same variable passed to `button: 'right'` on ANY call, not
#      just a `.click(` method call -- a right-click's own remount
#      hazard needs rightClickEdgeOffChip's post-click menu-content
#      verification (goal 0358 S9), which a plain method-call regex
#      can't tell apart from a left click; this catches the case in
#      function-call form too (e.g. a future helper reintroducing
#      clickEdgeOffChip's old signature), not just `edge.click(...)`.
#
# Escape hatch, same line as the call: a genuinely non-Atlas React
# Flow edge (a composition/workflow canvas edge -- no chip, a
# different bug class) may suppress with a same-line comment:
#   // edge-hover: not-atlas-link -- <why>
#
# Run by lefthook (pre-commit) and CI's e2e-edge-hover job -- one
# script both call, the same non-drift shape as check-e2e-seed-literals.sh.
set -euo pipefail

fixture="frontend/e2e/fixtures/atlasEdge.ts"
allow='edge-hover: not-atlas-link'

violations=0

while IFS= read -r -d '' file; do
  [[ "$file" == "$fixture" ]] && continue

  hits="$(grep -nE "\.react-flow__edge[^;]*\.(hover|click)\(" "$file" | grep -v "$allow" || true)"

  vars="$(grep -oE '(const|let) [A-Za-z0-9_]+ = [^;]*\.react-flow__edge' "$file" | sed -E 's/(const|let) ([A-Za-z0-9_]+) =.*/\2/' | sort -u || true)"
  while IFS= read -r var; do
    [[ -z "$var" ]] && continue
    varhits="$(grep -nE "\b${var}\.(hover|click)\(" "$file" | grep -v "$allow" || true)"
    if [[ -n "$varhits" ]]; then
      hits="$(printf '%s\n%s' "$hits" "$varhits")"
    fi
    rightvarhits="$(grep -nE "\b${var}\b" "$file" | grep -E "button: *['\"]right['\"]" | grep -v 'rightClickEdgeOffChip(' | grep -v "$allow" || true)"
    if [[ -n "$rightvarhits" ]]; then
      hits="$(printf '%s\n%s' "$hits" "$rightvarhits")"
    fi
  done <<< "$vars"

  hits="$(printf '%s\n' "$hits" | grep -v '^$' || true)"
  if [[ -n "$hits" ]]; then
    while IFS= read -r hit; do
      echo "check-e2e-edge-hover: $file:$hit"
      violations=$((violations + 1))
    done <<< "$hits"
  fi
done < <(git ls-files -z -- 'frontend/e2e/**/*.ts' 'frontend/e2e/*.ts')

if (( violations > 0 )); then
  cat >&2 <<'MSG'

A .react-flow__edge locator was hovered/clicked/right-clicked directly
instead of through fixtures/atlasEdge.ts's hoverEdgeOffChip/
rightClickEdgeOffChip.

The chip AtlasLinkEdge renders on hover/select sits at the edge's own
bounding-box center -- the exact point a bare hover()/click() targets
-- so every actionability retry re-intercepts on the chip until the
test times out (goal 0358 S8). A right-click carries a second hazard on
top of that (goal 0358 S9): a remount between the click's own
verification and its dispatch can hand the click to the pane behind
the edge, opening the wrong context menu -- a bare
`expect(menu).toBeVisible()` can't tell the two menus apart. Use:
  await hoverEdgeOffChip(page, edge)
  await rightClickEdgeOffChip(page, edge, menu, 'Change link kind')

A genuinely non-Atlas React Flow edge (a composition/workflow canvas
edge, no chip) may suppress this with a same-line comment:
  // edge-hover: not-atlas-link -- <why>
MSG
  exit 1
fi

echo "check-e2e-edge-hover: 0 violation(s)."
