import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { ATLAS_KIND_TOPIC, selectKind } from './kindPicker'

// Promoted out of atlas-authoring.spec.ts (goal 0081 slice A2,
// testing.md's "a helper used by 2+ spec files MUST be promoted" rule)
// once atlas-containment.spec.ts needed the same board locators/zoom
// plumbing.

export function noteCard(page: Page, title: string): Locator {
  return page.locator(`[data-testid="atlas-note-card"][aria-label="Flip ${title}"]`)
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

// Flips a note card in place then clicks its back face's Open button --
// the one path to the card page in the one-map model. Click TOGGLES the
// flip, so this only clicks when the card is currently front-facing --
// reopening an already-flipped card must not click it back to front
// first.
//
// The flip click is wrapped in a retry (the same expect(...).toPass
// idiom fixtures/canvasNode.ts's clickCanvasNode already established
// for this exact React Flow class): a card's own React Flow node is
// draggable in free/canvas-mode boards, so an occasional native
// click's mousedown/mouseup pair lands close enough together to read
// as a zero-distance micro-drag instead of a click, silently
// swallowing the onClick that would have toggled data-flipped --
// reproduced directly (not just in a full-suite run) via a throwaway
// repeat-click script, independent of any card-page editing.
export async function openViaFlip(card: Locator): Promise<void> {
  await expect(async () => {
    if ((await card.getAttribute('data-flipped')) !== 'true') {
      await card.click()
      await expect(card).toHaveAttribute('data-flipped', 'true', { timeout: 1_000 })
    }
  }).toPass({ timeout: 10_000, intervals: [300] })
  await card.getByTestId('atlas-note-open').click()
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
