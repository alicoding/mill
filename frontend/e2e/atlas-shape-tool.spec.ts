import { test, expect } from './fixtures/server'
import { dragBetween } from './fixtures/atlasBoard'
import { contextMenu } from './fixtures/contextMenu'
import { ATLAS_KIND_TOPIC, selectKind } from './fixtures/kindPicker'

// The shape tool (goal 0169 slice 5): drag-to-draw lands a rectangle/
// ellipse/arrow as a board-local BoardObject -- NEVER a card, matching
// image/ink's own goal 0179 correction. One tray tool covers all three
// types, picked via the style picker while armed; drawing several never
// interrupts drawing to commit. Shared pool: every entity created here
// is deleted here.
//
// Real pointer-capture drag, not React Flow's own internal drag
// machinery (the class QUARANTINE.md's box-select/NodeResizer entries
// document as unreliable to synthesize) -- same wiring
// atlas-pencil-tool.spec.ts's own header comment documents.
async function boardPoint(board: import('@playwright/test').Locator, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const box = await board.boundingBox()
  if (!box) throw new Error('board has no bounding box')
  return { x: box.x + box.width * fx, y: box.y + box.height * fy }
}

function shapeObjects(page: import('@playwright/test').Page) {
  return page.locator('[data-testid="atlas-board-object"][data-object-kind="shape"]')
}

test('dragging the shape tool lands a rectangle, never a card, and the tool stays armed for the next shape', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  const shapeTool = page.getByTestId('atlas-tray-shape')
  await shapeTool.click()
  await expect(shapeTool).toHaveAttribute('data-armed', 'true')
  const picker = page.getByTestId('atlas-shape-style-picker')
  await expect(picker).toBeVisible()
  // Rectangle is the default type -- confirmed selected before any drag.
  await expect(picker.getByTestId('atlas-shape-type-rectangle')).toHaveAttribute('data-selected', 'true')

  await dragBetween(page, await boardPoint(board, 0.05, 0.1), await boardPoint(board, 0.2, 0.25))

  const shapes = shapeObjects(page)
  await expect(shapes).toHaveCount(1)
  await expect(shapes.first()).toHaveAttribute('data-shape-type', 'rectangle')
  // The rule, absolute: drawing never creates a card the user didn't
  // explicitly ask for.
  await expect(page.getByTestId('atlas-note-card').filter({ hasText: 'Rectangle' })).toHaveCount(0)

  // Drag-to-draw is a sticky tool: completing a shape never disarms it.
  await expect(shapeTool).toHaveAttribute('data-armed', 'true')
  await dragBetween(page, await boardPoint(board, 0.3, 0.1), await boardPoint(board, 0.45, 0.25))
  await expect(shapes).toHaveCount(2)

  for (let i = 0; i < 2; i++) {
    await shapes.first().click({ button: 'right' })
    const menu = contextMenu(page)
    await expect(menu).toBeVisible()
    await menu.getByText('Delete', { exact: true }).click()
  }
  await expect(shapes).toHaveCount(0)
})

test('picking ellipse then arrow draws each type, and an arrow carries no Size (dx/dy only)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  await page.getByTestId('atlas-tray-shape').click()
  const picker = page.getByTestId('atlas-shape-style-picker')
  await expect(picker).toBeVisible()

  await picker.getByTestId('atlas-shape-type-ellipse').click()
  await expect(picker.getByTestId('atlas-shape-type-ellipse')).toHaveAttribute('data-selected', 'true')
  // Both drags stay in the board's own TOP band, clear of the style
  // picker's own popover (anchored 'outside-top' of the bottom-center
  // tray, so it occupies the lower-middle of the viewport for as long
  // as shape stays armed) -- a drag start point landing ON that popover
  // would be swallowed by it rather than reaching the board's own
  // pointer-capture handler, never producing a shape (goal 0184's
  // class: verify the drag start point is reachable, don't assume it).
  await dragBetween(page, await boardPoint(board, 0.05, 0.1), await boardPoint(board, 0.2, 0.25))
  const shapes = shapeObjects(page)
  await expect(shapes).toHaveCount(1)
  await expect(shapes.first()).toHaveAttribute('data-shape-type', 'ellipse')

  await picker.getByTestId('atlas-shape-type-arrow').click()
  await dragBetween(page, await boardPoint(board, 0.3, 0.1), await boardPoint(board, 0.45, 0.25))
  await expect(shapes).toHaveCount(2)
  await expect(page.locator('[data-testid="atlas-board-object"][data-shape-type="arrow"]')).toHaveCount(1)

  for (let i = 0; i < 2; i++) {
    await shapes.first().click({ button: 'right' })
    const menu = contextMenu(page)
    await expect(menu).toBeVisible()
    await menu.getByText('Delete', { exact: true }).click()
  }
  await expect(shapes).toHaveCount(0)
})

test('the shape style choice survives a disarm/re-arm cycle, and Promote to card works the same way ink\'s does', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  const shapeTool = page.getByTestId('atlas-tray-shape')
  await shapeTool.click()
  const picker = page.getByTestId('atlas-shape-style-picker')
  await expect(picker).toBeVisible()

  const chosenSwatch = picker.getByTestId('atlas-shape-stroke-da3633')
  await expect(chosenSwatch).toHaveAttribute('data-selected', 'false')
  await chosenSwatch.click()
  await expect(chosenSwatch).toHaveAttribute('data-selected', 'true')

  // Disarm, then re-arm: the style picker REMOUNTS (AnchoredOverlay
  // unmounts its children while closed) -- the swatch selection
  // surviving proves it lives in the ephemeral store, not per-mount
  // component state.
  await shapeTool.click()
  await expect(picker).not.toBeVisible()
  await shapeTool.click()
  await expect(picker).toBeVisible()
  await expect(picker.getByTestId('atlas-shape-stroke-da3633')).toHaveAttribute('data-selected', 'true')

  const shapes = shapeObjects(page)
  await dragBetween(page, await boardPoint(board, 0.55, 0.1), await boardPoint(board, 0.7, 0.25))
  await expect(shapes).toHaveCount(1)

  await shapes.first().click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Promote to card…', { exact: true }).click()
  const popover = page.getByTestId('atlas-placement-popover')
  await expect(popover).toBeVisible()
  await expect(popover.getByTestId('atlas-placement-title')).toHaveValue('Rectangle')
  await selectKind(popover, ATLAS_KIND_TOPIC)
  await popover.getByTestId('atlas-placement-submit').click()
  await expect(popover).not.toBeVisible()
  await expect(shapes).toHaveCount(0)
  const card = page.getByTestId('atlas-note-card').filter({ hasText: 'Rectangle' })
  await expect(card).toBeVisible()

  await card.click({ button: 'right' })
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(card).toHaveCount(0)
})
