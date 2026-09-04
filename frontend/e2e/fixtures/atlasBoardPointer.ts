// Pointer-geometry helpers for the Atlas board: drags, resize handles,
// hit-testable points. Split from atlasBoard.ts along the pointer seam
// (the 500-line convention); atlasBoard.ts re-exports them so callers
// keep one import.
import type { Locator, Page } from '@playwright/test'

// A drag endpoint expressed as (locator, offset) rather than an
// absolute page coordinate -- the only form Playwright's actionability
// pipeline can check, since a raw {x,y} has no element to retarget its
// hit-target check against (goal 0184 RESEARCH VERDICT). `position` is
// relative to `locator`'s own box; it may fall outside the box (e.g. a
// marquee corner drawn just past a card's own edge) -- that's still a
// valid page point, just not "on" the element itself.
export interface DragEndpoint {
  locator: Locator
  position: { x: number; y: number }
}

async function resolveDragPoint(v: { x: number; y: number } | DragEndpoint): Promise<{ x: number; y: number }> {
  if (!('locator' in v)) return v
  const box = await v.locator.boundingBox()
  if (!box) throw new Error('dragBetween: endpoint locator has no bounding box')
  return { x: box.x + v.position.x, y: box.y + v.position.y }
}

// Raw pointer drag (mousedown -> intermediate moves -> mouseup) --
// useAtlasSlotDrag.ts listens on window pointermove/pointerup, not
// React Flow's own node-drag or native HTML5 drag-and-drop, so this
// is what actually exercises it. Promoted out of atlas-slots.spec.ts
// (testing.md's "a helper used by 2+ spec files MUST be promoted"
// rule) once atlas-linking.spec.ts needed the same sequence.
//
// The START point is actionability-checked when `from` names a
// locator: `from.locator.hover({position})` runs Playwright's own
// Visible/Stable/Receives-Events pipeline at that exact pixel
// immediately before mouse.down(), retargeted the same way
// locator.click({position}) retargets its own hit-target check (goal
// 0184 RESEARCH VERDICT). The END point gets the identical check
// immediately before mouse.up() when `to` also names a locator (an
// element-bound release, e.g. dropping onto a frame). The path between
// them stays raw page.mouse.move -- Playwright's actionability model
// has no notion of a moving target, so the free-form middle of a drag
// is inherently unchecked; that is the documented boundary, not a gap.
// Pass a bare {x,y} for either end to skip its check where no owning
// element exists to check against. `onArrived` (optional) runs after
// the last move but before the end check/mouse.up(), for a caller that
// needs to assert mid-drag state while the button is still down.
// `onStep` (optional) runs after EVERY intermediate move, button still
// down -- for a caller sampling a per-frame property (a computed style,
// an element's own DOM identity) across the WHOLE drag rather than
// once at its end.
export async function dragBetween(
  page: Page,
  from: { x: number; y: number } | DragEndpoint,
  to: { x: number; y: number } | DragEndpoint,
  onArrived?: () => Promise<void>,
  onStep?: (step: number) => Promise<void>,
): Promise<void> {
  const steps = 12
  // The plain-{x,y} path never awaits resolveDragPoint (no locator to
  // resolve against) -- it stays exactly as synchronous as the raw
  // page.mouse call it replaces.
  const fromIsEndpoint = 'locator' in from
  const toIsEndpoint = 'locator' in to
  const fromPoint = fromIsEndpoint ? await resolveDragPoint(from) : from
  const toPoint = toIsEndpoint ? await resolveDragPoint(to) : to
  if (fromIsEndpoint) {
    await from.locator.hover({ position: from.position })
  } else {
    await page.mouse.move(fromPoint.x, fromPoint.y)
  }
  await page.mouse.down()
  // Lets React commit whatever re-render the mousedown itself
  // triggered (e.g. an Area-tool arm state settling) before the real
  // drag begins -- no observable DOM condition exists to poll for a
  // React commit itself, so this is a short, justified wait rather
  // than a guessed-duration substitute for one.
  await page.waitForTimeout(50)
  // React Flow's own node-drag tracking (@xyflow/system) samples the
  // delta between consecutive pointermove events -- a single big jump
  // from `from` to `to` can leave it never registering a real drag.
  // Dense intermediate steps make this indistinguishable from an
  // actual mouse drag.
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(fromPoint.x + ((toPoint.x - fromPoint.x) * i) / steps, fromPoint.y + ((toPoint.y - fromPoint.y) * i) / steps)
    if (onStep) await onStep(i)
  }
  if (onArrived) await onArrived()
  if ('locator' in to) {
    await to.locator.hover({ position: to.position })
  }
  await page.mouse.up()
}

// A fractional point within the board's own bounding box, expressed as
// a DragEndpoint so it feeds dragBetween's own start/end actionability
// check -- every canvas drag point below is computed this way so the
// whole test scales with whatever viewport Playwright actually
// renders, rather than hardcoded pixels. Promoted out of three
// identical per-spec copies (atlas-containment/atlas-pencil-tool/
// atlas-shape-tool.spec.ts, testing.md's promotion rule).
export async function boardPoint(board: Locator, fx: number, fy: number): Promise<DragEndpoint> {
  const box = await board.boundingBox()
  if (!box) throw new Error('board has no bounding box')
  return { locator: board, position: { x: box.width * fx, y: box.height * fy } }
}

// Clicks an absolute page point through the board's OWN actionability
// check, by converting it to a position relative to the board's box --
// preserves the exact target pixel a caller already reasoned about in
// page-absolute terms, while retargeting Playwright's hit-target check
// to it (goal 0184 RESEARCH VERDICT).
export async function clickBoardPoint(page: Page, point: { x: number; y: number }, opts?: Parameters<Locator['click']>[0]): Promise<void> {
  const board = page.getByTestId('atlas-board')
  const box = await board.boundingBox()
  if (!box) throw new Error('board has no bounding box')
  await board.click({ ...opts, position: { x: point.x - box.x, y: point.y - box.y } })
}

// The hover twin of clickBoardPoint: moves the pointer to an absolute
// page point through the board's own actionability check, for the
// pointer-following affordances (the table placement ghost) that need
// a real move before the click that commits them.
export async function hoverBoardPoint(page: Page, point: { x: number; y: number }): Promise<void> {
  const board = page.getByTestId('atlas-board')
  const box = await board.boundingBox()
  if (!box) throw new Error('board has no bounding box')
  await board.hover({ position: { x: point.x - box.x, y: point.y - box.y } })
}

// Drags a NodeResizer handle by a fixed pixel delta -- the shape every
// per-object resize test in this suite shares (image/note/table
// object/table card). Promoted once a fourth copy of the identical
// body appeared (testing.md's promotion rule). The START point is
// checked via `handle.hover({position})` immediately before
// mouse.down(), same contract as dragBetween above. Each intermediate
// step gets its own animation frame (waitForTimeout(50)) -- the
// resizer's own pointer-delta sampling coalesces synthesized moves
// that land in the same frame into zero measured motion (the recorded
// pointer-coalescing class, QUARANTINE.md atlas-table-resize).
// `onStep` (optional) runs after each intermediate move, mid-drag with
// the button still down -- for a caller asserting live-tracking state
// (a resize's own paint keeping up with the pointer before release).
export async function dragResizeHandle(page: Page, handle: Locator, dx: number, dy: number, steps = 6, onStep?: (i: number) => Promise<void>): Promise<void> {
  const hb = await handle.boundingBox()
  if (!hb) throw new Error('dragResizeHandle: handle has no bounding box')
  const position = { x: hb.width / 2, y: hb.height / 2 }
  await handle.hover({ position })
  await page.mouse.down()
  const start = { x: hb.x + position.x, y: hb.y + position.y }
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(start.x + (dx * i) / steps, start.y + (dy * i) / steps)
    await page.waitForTimeout(50)
    if (onStep) await onStep(i)
  }
  await page.mouse.up()
}

// A point within `locator`'s own box that Playwright's own
// actionability pipeline confirms is reachable (Visible/Stable/
// Receives-Events, via `locator.hover({position})`), not just its
// geometric center. Fixed screen chrome (a minimap, a creation tray)
// legitimately paints on top of board content wherever panning has
// left it, so a drag's start point must be verified reachable rather
// than assumed -- an occluded center silently starts the gesture on
// whatever chrome is on top instead of the intended card (goal 0170's
// measured cause; ruled expected canvas behavior, not a product
// defect -- the fix belongs in the test). Tries several candidate
// fractions rather than just the center, since a corner can be clear
// while the center is covered.
// FINDING (goal 0184 migration probe): a native locator.hover({position})
// per candidate fraction was tried here (routing this hand-rolled check
// through Playwright's own actionability pipeline, matching every other
// helper in this file) and reverted -- confirmed live that even a
// SUCCESSFUL hover pays Playwright's own settle-polling cost per
// candidate, and this function's caller (atlas-containment.spec.ts)
// calls it four times across an already-long flow; the accumulated
// overhead pushed the whole test past its 60s budget (timeout with no
// single stuck call, not a hang). elementFromPoint stays the fast,
// synchronous check this specific helper needs -- it already answers
// the real question ("is this exact point hittable") without an extra
// per-candidate wait budget.
// Clicks `locator` at a point hittablePointOn verified reachable,
// converted to the locator-relative position Playwright's own checked
// click wants -- for clicks on seeded content that fixed screen chrome
// (the minimap, the creation tray) may cover wherever the restored
// viewport left it.
export async function clickHittable(page: Page, locator: Locator): Promise<void> {
  const p = await hittablePointOn(page, locator)
  const box = await locator.boundingBox()
  if (!box) throw new Error('clickHittable: element has no bounding box')
  await locator.click({ position: { x: p.x - box.x, y: p.y - box.y } })
}

export async function hittablePointOn(page: Page, locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('element has no bounding box')
  const handle = await locator.elementHandle()
  if (!handle) throw new Error('element has no handle')
  try {
    const fractions = [0.5, 0.25, 0.75, 0.15, 0.85]
    for (const fy of fractions) {
      for (const fx of fractions) {
        const x = box.x + box.width * fx
        const y = box.y + box.height * fy
        const hit = await handle.evaluate((el, { x: px, y: py }) => {
          const top = document.elementFromPoint(px, py)
          return !!top && (top === el || el.contains(top))
        }, { x, y })
        if (hit) return { x, y }
      }
    }
  } finally {
    await handle.dispose()
  }
  throw new Error('no point on the element is actually hittable -- it is fully occluded by fixed chrome')
}
