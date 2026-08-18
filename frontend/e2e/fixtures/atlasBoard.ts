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
export async function clickCorner(board: Locator, corner: 'top-left' | 'top-right' | 'bottom-right'): Promise<void> {
  const box = await board.boundingBox()
  if (!box) throw new Error('board has no bounding box')
  const position =
    corner === 'top-left' ? { x: 12, y: 12 }
      : corner === 'top-right' ? { x: box.width - 12, y: 12 }
        : { x: box.width - 12, y: box.height - 12 }
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
    }).toPass({ timeout: 10_000, intervals: [300] })
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
  await popover.getByTestId('atlas-placement-submit').click()
  await expect(popover).not.toBeVisible()
  await expect(noteCard(page, title)).toBeVisible()
}

// Instant, no confirm (goal 0093's quick-delete-with-undo guard) --
// the card vanishes as soon as the menu item is clicked.
export async function deleteCardViaMenu(page: Page, menu: Locator, title: string): Promise<void> {
  await noteCard(page, title).click({ button: 'right' })
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(noteCard(page, title)).toHaveCount(0)
}
