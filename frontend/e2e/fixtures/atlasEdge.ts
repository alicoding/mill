import { expect, type Locator, type Page } from '@playwright/test'
import { waitForViewportStable } from './animation'

// An Atlas link edge's own chip renders at the midpoint, labelY + 18
// FLOW units below the line (AtlasLinkEdge) -- inside the zoomed
// viewport, so under a zoomed-out view that offset shrinks to a
// couple of screen pixels and the chip, once visible (hovered or
// selected), sits ON the exact point a bare edge.hover()/edge.click()
// targets: the center of the edge's own bounding box. Every
// actionability retry then re-intercepts on a chip button until the
// test timeout (goal 0358 S2's atlas-slots root cause). Hover/click a
// quarter along the interaction path instead -- the same gesture a
// user makes anywhere on the visible line, off the chip. Promoted out
// of atlas-slots.spec.ts (goal 0358 S8, testing.md's "2+ files" rule)
// once atlas-linking.spec.ts's own bare edge.hover() proved this was
// a class, not one spec's fix.
//
// A freshly-created edge can remount (a new DOM node, same visual
// line) while a live board re-syncs after the mutation that made it --
// goal 0358 S8's own measured root cause. The point is verified
// hittable via elementFromPoint in the SAME evaluate round-trip that
// measures it (the same atomic verify-then-use shape as
// hittablePointOn/clickHittable in atlasBoardPointer.ts), so a stale
// measurement throws immediately instead of being handed to
// Playwright's own multi-second actionability polling -- polling that
// itself spans the remount window a bare retry loop can't shrink.
async function edgePointAbsolute(edge: Locator): Promise<{ x: number; y: number }> {
  const handle = await edge.locator('.react-flow__edge-interaction').elementHandle()
  if (!handle) throw new Error('edge has no interaction path')
  try {
    return await handle.evaluate((el) => {
      const p = el as unknown as SVGPathElement
      const at = p.getPointAtLength(p.getTotalLength() * 0.25)
      const ctm = p.getScreenCTM()
      if (!ctm) throw new Error('interaction path has no screen CTM')
      const screen = at.matrixTransform(ctm)
      const top = document.elementFromPoint(screen.x, screen.y)
      if (top !== el) throw new Error('off-chip point is not hittable at measurement time -- the edge likely remounted')
      return { x: screen.x, y: screen.y }
    })
  } finally {
    await handle.dispose()
  }
}

export async function edgePositionOffChip(edge: Locator): Promise<{ x: number; y: number }> {
  const box = await edge.boundingBox()
  if (!box) throw new Error('edge has no bounding box')
  const point = await edgePointAbsolute(edge)
  return { x: point.x - box.x, y: point.y - box.y }
}

// The edge's geometry moves under load (goal 0358 S8's root cause: a
// remount reflows the path mid-retry), so a position computed ONCE
// and replayed against later attempts goes stale -- the same "point
// computed once, replayed against later geometry" family as
// clickCanvasNode/hittablePointOn. edgePositionOffChip is re-resolved
// INSIDE Playwright's own retrying expect(...).toPass(), never cached
// across attempts. `force: true`: edgePositionOffChip already proved
// the point hittable a moment ago, so the action skips Playwright's
// OWN visible/stable/receives-events polling -- the thing that was
// long enough to span a remount and land on the pane underneath.
export async function hoverEdgeOffChip(page: Page, edge: Locator): Promise<void> {
  await waitForViewportStable(page.getByTestId('atlas-board'))
  await expect(async () => {
    const position = await edgePositionOffChip(edge)
    await edge.hover({ position, force: true, timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
}

// A right-click's own remount hazard is one step worse than a plain
// hover's (goal 0358 S9, second strike of the S8 class): confirmed live
// (a captured error-context snapshot on a failing 4x-throttle attempt)
// -- a miss opens AtlasBoard's own PANE menu ("Add card"/"New
// space…"), not the edge's, because the browser's real hit-test at
// dispatch time found the pane underneath instead of the edge this
// attempt had just verified hittable. Instrumenting a live run under
// real 4-worker contention pinned WHY a discrete click (not hover) is
// the fragile half, and why re-resolving/re-verifying the point (this
// file's own hover fix, then a raw mouse click AT the just-hovered,
// unmoved cursor position) still measured a 100% miss rate across 33
// straight retries with STABLE, seemingly-correct coordinates: at a
// fully zoomed-out view, React Flow's own invisible interaction stroke
// (`interactionWidth`, 20 FLOW units -- @xyflow/react's own BaseEdge)
// shrinks to under 1 SCREEN pixel here, thinner than the chip midpoint
// goal 0358 S2 already found too small to click -- a discrete click's
// hit-test is a single-instant check that a sub-1px band puts on the
// wrong side of the browser's own rounding under throttled load, no
// matter how precisely the point is computed. HOVER's own multi-step
// interpolated move instead crosses that band incrementally and
// latches via mouseenter/`:hover`, which is what makes hoverEdgeOffChip
// itself reliable at the same coordinates.
//
// So this fixture doesn't aim a click at the sub-pixel band at all:
// React Flow's own edge wrapper is keyboard-focusable by default
// (`tabIndex=0`, @xyflow/react's EdgeWrapper -- `edgesFocusable`) and
// binds the exact SAME `onContextMenu` handler a mouse right-click
// would; focusing it, then pressing the OS `ContextMenu` key, has the
// BROWSER ITSELF dispatch a native `contextmenu` event targeted at the
// focused element -- the same event a screen-reader/keyboard user
// triggers this same menu with, so this is a real, already-adopted
// interaction the app supports, not an invented one. `Locator.focus()`
// is a last resort against testing.md's own "focus via clicking/
// tabbing" default (justified here, same line): no coordinate is ever
// computed, so no coordinate can ever be wrong.
//
// A bare `expect(menu).toBeVisible()` right after can't tell a hit
// from a miss on its own -- the pane menu (a leftover, still-open one)
// would satisfy it too -- so `expectItemText` names the one item only
// the intended edge's own menu carries, checked inside the same toPass
// as the focus+key, so a wrong-menu outcome retries the whole gesture.
// A miss's own wrong menu, left open, would otherwise wedge every
// later retry behind it (confirmed live on the coordinate-based cut
// above: three straight attempts landed on the identical wrong-menu
// snapshot across the whole budget) -- Escape closes whatever's open
// before each attempt.
export async function rightClickEdgeOffChip(page: Page, edge: Locator, menu: Locator, expectItemText: string): Promise<void> {
  await waitForViewportStable(page.getByTestId('atlas-board'))
  await expect(async () => {
    if (await menu.isVisible()) {
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden({ timeout: 2_000 })
    }
    await edge.focus() // programmatic focus, last resort: no click-based path can reach a sub-1px interaction band reliably (see comment above)
    await page.keyboard.press('ContextMenu')
    await expect(menu.getByText(expectItemText, { exact: true })).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
}
