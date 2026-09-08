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
export async function edgePositionOffChip(edge: Locator): Promise<{ x: number; y: number }> {
  const box = await edge.boundingBox()
  if (!box) throw new Error('edge has no bounding box')
  const handle = await edge.locator('.react-flow__edge-interaction').elementHandle()
  if (!handle) throw new Error('edge has no interaction path')
  try {
    const point = await handle.evaluate((el) => {
      const p = el as unknown as SVGPathElement
      const at = p.getPointAtLength(p.getTotalLength() * 0.25)
      const ctm = p.getScreenCTM()
      if (!ctm) throw new Error('interaction path has no screen CTM')
      const screen = at.matrixTransform(ctm)
      const top = document.elementFromPoint(screen.x, screen.y)
      if (top !== el) throw new Error('off-chip point is not hittable at measurement time -- the edge likely remounted')
      return { x: screen.x, y: screen.y }
    })
    return { x: point.x - box.x, y: point.y - box.y }
  } finally {
    await handle.dispose()
  }
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

export async function clickEdgeOffChip(
  page: Page,
  edge: Locator,
  options: { button?: 'left' | 'right' | 'middle' } = {},
): Promise<void> {
  await waitForViewportStable(page.getByTestId('atlas-board'))
  await expect(async () => {
    const position = await edgePositionOffChip(edge)
    await edge.click({ position, force: true, timeout: 2_000, ...options })
  }).toPass({ timeout: 15_000 })
}
