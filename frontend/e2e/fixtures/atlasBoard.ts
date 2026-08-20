import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { ATLAS_KIND_TOPIC, selectKind } from './kindPicker'

// Promoted out of atlas-authoring.spec.ts (goal 0081 slice A2,
// testing.md's "a helper used by 2+ spec files MUST be promoted" rule)
// once atlas-containment.spec.ts needed the same board locators/zoom
// plumbing.

export function noteCard(page: Page, title: string): Locator {
  return page.locator(`[data-testid="atlas-note-card"][aria-label="Open ${title}"]`)
}

// Raw pointer drag (mousedown -> intermediate moves -> mouseup) --
// useAtlasSlotDrag.ts listens on window pointermove/pointerup, not
// React Flow's own node-drag or native HTML5 drag-and-drop, so this
// is what actually exercises it. Promoted out of atlas-slots.spec.ts
// (testing.md's "a helper used by 2+ spec files MUST be promoted"
// rule) once atlas-linking.spec.ts needed the same sequence.
export async function dragBetween(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const steps = 12
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.waitForTimeout(50)
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)
  }
  await page.mouse.up()
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
export async function armAndPlaceTopicCard(page: Page, board: Locator, popover: Locator, fx: number, fy: number, title: string): Promise<void> {
  await page.keyboard.press('c')
  const box = await board.boundingBox()
  if (!box) throw new Error('board has no bounding box')
  await board.click({ position: { x: box.width * fx, y: box.height * fy } })
  await expect(popover).toBeVisible()
  await selectKind(popover, ATLAS_KIND_TOPIC)
  await popover.getByTestId('atlas-placement-title').fill(title)
  await submitCreatePopover(popover)
  await expect(popover).not.toBeVisible()
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
  const candidates = at ? [at] : [{ x: 400, y: 500 }, { x: 300, y: 620 }, { x: 1000, y: 640 }, { x: 250, y: 250 }]
  let point = candidates[0]
  for (const c of candidates) {
    const isPane = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.classList?.contains('react-flow__pane') ?? false, [c.x, c.y])
    if (isPane) {
      point = c
      break
    }
  }
  await page.mouse.click(point.x, point.y)
  const popover = page.getByTestId('atlas-placement-popover')
  await expect(popover).toBeVisible()
  return popover
}

export async function createCardViaTray(page: Page, title: string, opts?: { kindID?: string; at?: { x: number; y: number } }) {
  const popover = await openPlacementPopover(page, opts?.at)
  if (opts?.kindID) await selectKind(page, opts.kindID, 'atlas-placement-kind')
  await popover.getByTestId('atlas-placement-title').fill(title)
  await popover.getByTestId('atlas-placement-title').press('Enter')
  await expect(popover).toHaveCount(0)
}
