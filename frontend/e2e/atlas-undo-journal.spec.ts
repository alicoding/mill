import { test, expect } from './fixtures/server'
import { boardPoint, createCardViaTray, deleteCardViaMenu, dragBetween, hittablePointOn, noteCard } from './fixtures/atlasBoard'
import { contextMenu } from './fixtures/contextMenu'

// The actor-scoped undo journal's own board-level proof (goal 0219 S2,
// ADR-0044): ⌘Z/⇧⌘Z generalize goal 0093's delete-only listener to
// every mutation door -- a drawn stroke, a dragged card, and (in
// atlas-eraser-laser.spec.ts's own extra case) an eraser delete all
// undo/redo through the SAME journal. Shared pool: every entity
// created here is deleted (or already removed by undo) here.

function inkObjects(page: import('@playwright/test').Page) {
  return page.locator('[data-testid="atlas-board-object"][data-object-kind="ink"]')
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

  // Placed in the board's own empty bottom-right quadrant (clear of
  // the seeded example space and the tray/minimap) so the drag below
  // has nothing to file into -- a plain reposition, not a reparent.
  await createCardViaTray(page, 'Drag Me Back', { at: { x: 900, y: 550 } })
  const card = noteCard(page, 'Drag Me Back')
  await expect(card).toBeVisible()
  const origin = await card.boundingBox()
  if (!origin) throw new Error('card has no bounding box before drag')

  // One continuous drag (several intermediate points, like a real
  // pointer path), staying inside the same empty quadrant -- onNodeDragStop
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
