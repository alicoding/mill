import { test, expect } from './fixtures/server'
import { boardPoint, createCardViaTray, deleteCardViaMenu, dragBetween, hittablePointOn, noteCard, nonSeededBoardObjects, zoomAllTheWayOut } from './fixtures/atlasBoard'
import { contextMenu } from './fixtures/contextMenu'
import { findEmptyBoardRect } from './fixtures/atlasEmptyRegion'

// The actor-scoped undo journal's own board-level proof (goal 0219 S2,
// ADR-0044): ⌘Z/⇧⌘Z generalize goal 0093's delete-only listener to
// every mutation door -- a drawn stroke, a dragged card, and (in
// atlas-eraser-laser.spec.ts's own extra case) an eraser delete all
// undo/redo through the SAME journal. Shared pool: every entity
// created here is deleted (or already removed by undo) here.

function inkObjects(page: import('@playwright/test').Page) {
  return nonSeededBoardObjects(page, 'ink')
}

test('drawing a stroke: ⌘Z removes it, ⇧⌘Z brings it back', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  const pencilTool = page.getByTestId('atlas-tray-pencil')
  await pencilTool.click()
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')

  await dragBetween(page, await boardPoint(board, 0.06, 0.12), await boardPoint(board, 0.16, 0.22))
  const ink = inkObjects(page)
  await expect(ink).toHaveCount(1)

  // ⌘Z undoes the stroke's own create door -- the object disappears.
  await page.keyboard.press('Meta+z')
  await expect(ink).toHaveCount(0)

  // ⇧⌘Z redoes it -- the exact same object comes back.
  await page.keyboard.press('Meta+Shift+z')
  await expect(ink).toHaveCount(1)

  // Clean up: undo again so this stroke never lingers into another test.
  await page.keyboard.press('Meta+z')
  await expect(ink).toHaveCount(0)
})

test('dragging a card: ⌘Z returns it to where it started, as ONE step for the whole drag', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  // Zoomed out (goal 0223's own pattern, atlasBoard.ts's own
  // zoomAllTheWayOut) so seeded content shrinks toward the center and
  // leaves real room to search -- a region clear of every currently-
  // rendered node AND the creation tray (atlasEmptyRegion.ts) rather
  // than a fixed pixel, since a fixed point that used to clear the
  // bottom toolbar can end up underneath it the moment the landing
  // board's own seeded content extent shifts. The card is placed
  // 140/100 in from the region's own top-left, not at it, so the drag
  // below (-120,-80) has nothing to file into AND stays clear of the
  // board's own edge -- placing right at a found region's corner left
  // no margin for the drag itself, and a release point near the board
  // edge triggers React Flow's own auto-pan, which the undo's exact-
  // position assertion below has no way to account for.
  await zoomAllTheWayOut(page)
  const creationTray = page.getByTestId('atlas-creation-tray')
  const region = await findEmptyBoardRect(page, board, 320, 240, [creationTray])
  const spot = { x: region.x + 140, y: region.y + 100 }
  await createCardViaTray(page, 'Drag Me Back', { at: spot })
  const card = noteCard(page, 'Drag Me Back')
  await expect(card).toBeVisible()
  const origin = await card.boundingBox()
  if (!origin) throw new Error('card has no bounding box before drag')

  // One continuous drag (several intermediate points, like a real
  // pointer path), staying inside the same empty region -- onNodeDragStop
  // fires SetPosition exactly ONCE at release, so this is naturally one mark.
  await dragBetween(
    page,
    await hittablePointOn(page, card),
    { x: origin.x - 120, y: origin.y - 80 },
  )
  await expect.poll(async () => (await card.boundingBox())?.x).not.toBeCloseTo(origin.x, 0)

  await page.keyboard.press('Meta+z')
  await expect.poll(async () => (await card.boundingBox())?.x, { timeout: 5_000 }).toBeCloseTo(origin.x, 0)
  await expect.poll(async () => (await card.boundingBox())?.y, { timeout: 5_000 }).toBeCloseTo(origin.y, 0)

  // Clean up.
  const menu = contextMenu(page)
  await deleteCardViaMenu(page, menu, 'Drag Me Back')
})
