import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { ATLAS_KIND_TOPIC, selectKind } from './kindPicker'
import { contextMenu } from './contextMenu'

// Promoted out of atlas-authoring.spec.ts (goal 0081 slice A2,
// testing.md's "a helper used by 2+ spec files MUST be promoted" rule)
// once atlas-containment.spec.ts needed the same board locators/zoom
// plumbing.

export function noteCard(page: Page, title: string): Locator {
  return page.locator(`[data-testid="atlas-note-card"][aria-label="Open ${title}"]`)
}

// nonSeededBoardObjects -- every kind-scoped board-object locator a
// shared-pool spec uses to find only the object(s) IT created, never
// goal 0223's seeded examples (internal/domain/atlas/
// boardobject_builtin.go) that already exist at the same root level
// under the ID prefix "atlas-object-example-". Promoted (testing.md's
// "2+ spec files" rule) once every drag-to-draw/paste-or-drop board-
// object spec needed the same exclusion.
export function nonSeededBoardObjects(page: Page, kind: string): Locator {
  return page.locator(`.react-flow__node:not([data-id^="atlas-object-example-"]) [data-testid="atlas-board-object"][data-object-kind="${kind}"]`)
}

// The `.react-flow__node` wrapper of a non-seeded object of the given
// kind. Reusing nonSeededBoardObjects(...).first() as a `.filter({
// has })` needle is unsafe: `has` re-queries its locator relative to
// each candidate, so the needle's own leading `.react-flow__node:not
// (...)` clause would demand a SECOND, nested `.react-flow__node`
// inside the candidate -- which never exists, React Flow renders
// exactly one wrapper per node -- and the filter always resolves to
// zero matches. Here the ancestor exclusion applies to the wrapper
// locator itself instead, and the `has` needle stays descendant-only.
export function nonSeededBoardObjectWrapper(page: Page, kind: string): Locator {
  return page
    .locator('.react-flow__node:not([data-id^="atlas-object-example-"])')
    .filter({ has: page.locator(`[data-testid="atlas-board-object"][data-object-kind="${kind}"]`) })
}

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

// Right-clicks a board object (goal 0179 S2's own "table"/"diagram"
// board objects join image/shape's own Promote to card path,
// atlas-shape-tool.spec.ts's inline version promoted here once
// atlas-table-object.spec.ts needed the identical sequence): "Promote
// to card…", fill the title, pick a kind, submit. Returns nothing --
// what the promoted card renders AS (a plain note-card face, or the
// table-projection unit's own atlas-table-card) depends on the
// object's own Kind, so callers locate their own resulting node with
// whichever testid actually fits it.
export async function promoteBoardObject(page: Page, object: Locator, title: string, kindID = ATLAS_KIND_TOPIC): Promise<void> {
  await object.click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Promote to card…', { exact: true }).click()
  const popover = page.getByTestId('atlas-placement-popover')
  await expect(popover).toBeVisible()
  await popover.getByTestId('atlas-placement-title').fill(title)
  await selectKind(popover, kindID)
  await popover.getByTestId('atlas-placement-submit').click()
  await expect(popover).not.toBeVisible()
}

export function groupCard(page: Page, title: string): Locator {
  return page.locator('[data-testid="atlas-group-card"]').filter({ has: page.locator(`[aria-label="Zoom into ${title}"]`) })
}

// Zooms the CURRENT board's viewport all the way out -- every existing
// card/note shrinks toward the board's center, leaving a wide empty
// margin at every corner regardless of how much seeded or test-created
// content the board already carries. Clicking a corner AFTER this is
// what makes clickCorner below reliable: a fixed screen pixel stays
// empty because content moved away from it, not because its flow-space
// position was ever guessed.
export async function zoomAllTheWayOut(page: Page): Promise<void> {
  const zoomOut = page.locator('.react-flow__controls-zoomout')
  for (let i = 0; i < 8; i++) await zoomOut.click()
}

// Each corner stays empty across a whole test (seeded/created content
// shrunk to the center by zoomAllTheWayOut, React Flow's own Controls
// only occupies the bottom-left, the creation tray only the
// bottom-center) -- use each corner for AT MOST ONE placement per
// test file so a fixed screen pixel's flow-space mapping never
// collides with something the test itself just created there.
// Deliberately no 'bottom-right' option: the board's own minimap
// (goal 0106 slice B) now occupies that corner, so it's never a
// reliably-empty click target -- callers needing a bottom-right-ish
// point compute their own, clear of the minimap's footprint.
export async function clickCorner(board: Locator, corner: 'top-left' | 'top-right'): Promise<void> {
  const box = await board.boundingBox()
  if (!box) throw new Error('board has no bounding box')
  const position = corner === 'top-left' ? { x: 12, y: 12 } : { x: box.width - 12, y: 12 }
  await board.click({ position })
}

// Opens a card's own page: the click model (goal 0102) makes a plain
// click SELECT, and a second plain click on the now-selected card
// COMMIT (open) -- this helper plays both clicks, wrapped in the same
// expect(...).toPass retry fixtures/canvasNode.ts's clickCanvasNode
// already established for this exact React Flow class (a card's own
// node is draggable in free-mode boards, so an occasional native
// click's mousedown/mouseup pair lands close enough together to read
// as a zero-distance micro-drag instead of a click, silently
// swallowing the selection the second click depends on).
export async function openCard(page: Page, card: Locator): Promise<void> {
  const selectedWrapper = page.locator('.react-flow__node.selected').filter({ has: card })
  // A card left selected from an earlier interaction commits on the
  // very first click (goal 0102's gesture table) -- only click twice
  // when it's starting unselected.
  if (await selectedWrapper.count() === 0) {
    await expect(async () => {
      await card.click()
      await expect(selectedWrapper).toHaveCount(1, { timeout: 1_000 })
        // CI runners under load need longer than local for the same
    // re-delivered interaction (0134's shard-1 cluster: three same-day
    // occurrences of this poll expiring on a loaded runner).
  }).toPass({ timeout: process.env.CI ? 25_000 : 10_000, intervals: [300] })
  }
  await card.click()
  await expect(page.getByTestId('atlas-page-header')).toBeVisible()
}

// Closes a card's own page (Escape) and waits for it to be REALLY
// gone, not just its own content -- Primer's Dialog animates its
// backdrop out asynchronously, and a tight open/close/interact cycle
// (this spec's own repeated openCard calls) can outrun that animation,
// leaving a stray backdrop element still covering the board and
// swallowing the very next click as a hit-test miss (reproduced live:
// a right-click immediately after a close landed on
// `.prc-Dialog-Backdrop-*` instead of the card underneath it). Any
// test that closes a card page and immediately does another POINTER
// interaction with the board should use this instead of a bare
// Escape press.
export async function closeCard(page: Page, overlay: Locator): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()
  await expect(page.locator('[class*="Backdrop"]')).toHaveCount(0)
}

// Promoted from atlas-containment.spec.ts when atlas-select-group.spec.ts
// became a second consumer (testing.md's helpers-live-in-fixtures rule).
export async function armAndPlaceTopicCard(page: Page, board: Locator, _popover: Locator, fx: number, fy: number, title: string): Promise<void> {
  // Instant placement (goal 0144): the click creates the card
  // (last-used kind seeded to Topic) and the title edits inline.
  await page.evaluate((kindID) => localStorage.setItem('atlas.lastKindId', kindID), ATLAS_KIND_TOPIC)
  await page.keyboard.press('c')
  const box = await board.boundingBox()
  if (!box) throw new Error('board has no bounding box')
  await board.click({ position: { x: box.width * fx, y: box.height * fy } })
  const inline = page.getByTestId('atlas-inline-title')
  await expect(inline).toBeVisible()
  await inline.fill(title)
  await inline.press('Enter')
  await expect(noteCard(page, title)).toBeVisible()
}

// The placement popover's own 'create' mode carries no visible Submit/
// Cancel row (goal 0106 slice B contract item 4: Enter/Escape are the
// only commit/cancel paths, matching the C -> click -> title -> Enter
// loop itself) -- every test driving 'create' mode (the tray/right-
// click/paste/slot-guided doors) confirms this way now. 'promote'/
// 'area' mode keep their own labeled form + button row untouched, so
// tests in those modes keep clicking atlas-placement-submit/-cancel
// directly rather than using these two helpers.
export async function submitCreatePopover(popover: Locator): Promise<void> {
  await popover.getByTestId('atlas-placement-title').press('Enter')
}

export async function cancelCreatePopover(popover: Locator): Promise<void> {
  await popover.getByTestId('atlas-placement-title').press('Escape')
}

// Instant, no confirm (goal 0093's quick-delete-with-undo guard) --
// the card vanishes as soon as the menu item is clicked.
export async function deleteCardViaMenu(page: Page, menu: Locator, title: string): Promise<void> {
  await noteCard(page, title).click({ button: 'right' })
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(noteCard(page, title)).toHaveCount(0)
}

// Clicks a region frame's blank left gutter -- the GROUP_PADDING strip
// between the frame's left edge and its first child column, the one
// reliably blank band a frame has at every child count. Two traps this
// helper exists to close, both hit by the fraction-click idiom it
// replaces:
// 1. The position must be computed from a SETTLED bounding box.
//    fitView animates node geometry after board load; a box measured
//    mid-animation yields a click offset (notably y = staleHeight/2)
//    that lands outside the settled frame -- on the pane -- and stays
//    wrong forever, because Playwright re-resolves the element but
//    never the caller-supplied position.
// 2. The x offset must clear the frame's border without overshooting
//    the gutter: on a zoomed-out board the whole gutter is ~5px, so a
//    width-proportional offset drifts onto the first child card while
//    a too-small one hits the border. A fixed 3-4px sits inside the
//    gutter at every zoom the suite produces.
export async function clickFrameGutter(frame: Locator, opts?: Parameters<Locator['click']>[0]): Promise<void> {
  let previous = ''
  await expect
    .poll(async () => {
      const box = await frame.boundingBox()
      const key = box ? [box.x, box.y, box.width, box.height].map(v => Math.round(v)).join(',') : 'none'
      const stable = previous === key && key !== 'none'
      previous = key
      return stable
    }, { timeout: 10_000 })
    .toBe(true)
  const box = await frame.boundingBox()
  if (!box) throw new Error('clickFrameGutter: expected the frame to be measurable')
  const x = Math.max(3, Math.min(4, box.width * 0.02))
  await frame.click({ ...opts, position: { x, y: box.height * 0.5 } })
}

// A breadcrumb segment now opens a SIBLING dropdown on click (goal
// 0106 slice B contract item 5) rather than navigating directly -- the
// segment's own place is always present in that dropdown, marked
// selected, so clicking IT there reproduces the crumb's old direct-
// navigate-on-click behavior. `segment` is whatever Locator the caller
// already built (its own `.nth()`/`.first()`/`{ exact }` disambiguation
// among same-titled crumbs stays exactly as before); `label` is that
// same segment's own title, used to find its entry inside the freshly-
// opened, scoped dropdown -- unambiguous there regardless of how many
// OTHER crumbs in the trail share that title, since only ONE level's
// siblings are ever listed at a time.
export async function clickBreadcrumbSegment(page: Page, segment: Locator, label: string): Promise<void> {
  await segment.click()
  await page.getByTestId('atlas-breadcrumb-siblings').getByText(label, { exact: true }).click()
}

// Toolbar-first creation (goal 0139, the + Add menu's replacement):
// arm the Card tool, click a free canvas point, complete the
// placement popover. The default point sits low-left, clear of the
// seeded board's cards/notes, the bottom-center tray (a card landing
// under the tray can't be clicked), and the minimap. Kind is the
// picker's testId contract (atlas-placement-kind); omit to keep the
// last-used default.
export async function openPlacementPopover(page: Page, at?: { x: number; y: number }) {
  await page.getByTestId('atlas-tray-card').click()
  // Candidate points are tried until one is genuinely empty pane --
  // an earlier create in the same test may already occupy a spot.
  // The 2nd/3rd points were originally {300,620}/{1000,640} -- close
  // enough to the board's own bottom edge (a shorter viewport, or a
  // taller app chrome above it, clips content past a certain y) that a
  // card placed there renders with its CENTER outside the board's own
  // visible/hit-testable area, even though its top sliver still reads
  // as "pane" for this very isPane probe. Raised to keep every
  // candidate's full card comfortably inside the board on the
  // suite's default viewport, clear of the tray and the minimap.
  const candidates = at ? [at] : [{ x: 400, y: 500 }, { x: 300, y: 480 }, { x: 700, y: 300 }, { x: 250, y: 250 }]
  let point = candidates[0]
  for (const c of candidates) {
    const isPane = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.classList?.contains('react-flow__pane') ?? false, [c.x, c.y])
    if (isPane) {
      point = c
      break
    }
  }
  await clickBoardPoint(page, point)
  const popover = page.getByTestId('atlas-placement-popover')
  await expect(popover).toBeVisible()
  return popover
}

export async function createCardViaTray(page: Page, title: string, opts?: { kindID?: string; at?: { x: number; y: number } }) {
  // Instant placement (goal 0144): kind rides the last-used seed,
  // the title edits inline on the new node.
  if (opts?.kindID) await page.evaluate((kindID) => localStorage.setItem('atlas.lastKindId', kindID), opts.kindID)
  await page.getByTestId('atlas-tray-card').click()
  // See openPlacementPopover's own comment above on why the 2nd/3rd
  // points were raised from their original {300,620}/{1000,640}.
  const candidates = opts?.at ? [opts.at] : [{ x: 400, y: 500 }, { x: 300, y: 480 }, { x: 700, y: 300 }, { x: 250, y: 250 }]
  let point = candidates[0]
  for (const c of candidates) {
    const isPane = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.classList?.contains('react-flow__pane') ?? false, [c.x, c.y])
    if (isPane) {
      point = c
      break
    }
  }
  await clickBoardPoint(page, point)
  const inline = page.getByTestId('atlas-inline-title')
  await expect(inline).toBeVisible()
  await inline.fill(title)
  await inline.press('Enter')
  await expect(inline).toHaveCount(0)
}

// Promoted from atlas-capture.spec.ts once atlas-note-markdown.spec.ts
// needed the same cleanup (testing.md's "a helper used by 2+ spec
// files MUST be promoted" rule): removes a persisted sticky note
// straight off the board via its own context menu, no page to open.
export async function deleteSticky(page: Page, sticky: Locator): Promise<void> {
  await sticky.click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete note', { exact: true }).click()
  await expect(sticky).toHaveCount(0)
}
