import { test, expect } from './fixtures/server'
import { dragBetween, createCardViaTray, noteCard, deleteCardViaMenu } from './fixtures/atlasBoard'
import { contextMenu } from './fixtures/contextMenu'

// The eraser (drag-to-erase) and the laser (ephemeral-drag) -- goal
// 0169 slice 4's own proof, and this arc's fifth/sixth interaction
// shapes put into real use. Shared pool: every entity created here is
// deleted here.
//
// Real pointer-capture drags, not React Flow's own internal drag
// machinery (the class QUARANTINE.md documents as unreliable to
// synthesize) -- both tools are wired the exact same
// onPointerDownCapture/MoveCapture/UpCapture way the Area/Pencil tools
// already are, which atlas-pencil-tool.spec.ts already proves reliably
// synthesizable via page.mouse with dense intermediate moves.

test('dragging the eraser across a card removes it, and the quick-delete undo toast brings it back', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  await createCardViaTray(page, 'Erase Me')
  const card = noteCard(page, 'Erase Me')
  await expect(card).toBeVisible()
  const box = await card.boundingBox()
  if (!box) throw new Error('card has no bounding box')

  const eraserTool = page.getByTestId('atlas-tray-eraser')
  await eraserTool.click()
  await expect(eraserTool).toHaveAttribute('data-armed', 'true')

  // A horizontal sweep starting well left of the card and ending well
  // right of it -- the intermediate points dragBetween samples land
  // inside the card's own box partway through.
  await dragBetween(
    page,
    { x: box.x - 40, y: box.y + box.height / 2 },
    { x: box.x + box.width + 40, y: box.y + box.height / 2 },
  )

  await expect(card).toHaveCount(0)

  // Not unrecoverable: the eraser hands its hit set to the SAME
  // onDeleteSelection door the selection tray's Delete key uses, which
  // rides goal 0093's quick-delete-with-undo guard -- proven here by
  // actually clicking Undo and getting the card back, not just by
  // asserting the toast's own presence.
  const undoToast = page.getByTestId('atlas-undo-toast')
  await expect(undoToast).toBeVisible()
  await page.getByTestId('atlas-undo-toast-button').click()
  await expect(card).toBeVisible()

  // Sticky tool: the eraser stays armed after a pass, matching the
  // pencil's own convention.
  await expect(eraserTool).toHaveAttribute('data-armed', 'true')

  const menu = contextMenu(page)
  await deleteCardViaMenu(page, menu, 'Erase Me')
})

// goal 0219 S2, ADR-0044: the eraser's delete rides the same actor-
// scoped undo journal every other door does -- ⌘Z restores it exactly
// like the toast's own Undo button (already proven above), without a
// toast click.
test('dragging the eraser across a card removes it, and ⌘Z brings it back', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  await createCardViaTray(page, 'Erase Me Too')
  const card = noteCard(page, 'Erase Me Too')
  await expect(card).toBeVisible()
  const box = await card.boundingBox()
  if (!box) throw new Error('card has no bounding box')

  const eraserTool = page.getByTestId('atlas-tray-eraser')
  await eraserTool.click()
  await expect(eraserTool).toHaveAttribute('data-armed', 'true')

  await dragBetween(
    page,
    { x: box.x - 40, y: box.y + box.height / 2 },
    { x: box.x + box.width + 40, y: box.y + box.height / 2 },
  )
  await expect(card).toHaveCount(0)

  await page.keyboard.press('Meta+z')
  await expect(card).toBeVisible()

  const menu = contextMenu(page)
  await deleteCardViaMenu(page, menu, 'Erase Me Too')
})

test('dragging the laser across the board draws a fading trail, creates nothing, and leaves no trace once it fades', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  const cardsBefore = await page.getByTestId('atlas-note-card').count()

  const laserTool = page.getByTestId('atlas-tray-laser')
  await laserTool.click()
  await expect(laserTool).toHaveAttribute('data-armed', 'true')

  const boardBox = await board.boundingBox()
  if (!boardBox) throw new Error('board has no bounding box')
  await dragBetween(
    page,
    { x: boardBox.x + boardBox.width * 0.2, y: boardBox.y + boardBox.height * 0.3 },
    { x: boardBox.x + boardBox.width * 0.4, y: boardBox.y + boardBox.height * 0.4 },
  )

  // The trail is still fading immediately after release -- rendered
  // from local component state only, never a persisted card.
  await expect(page.getByTestId('atlas-laser-trail')).toBeVisible()
  expect(await page.getByTestId('atlas-note-card').count()).toBe(cardsBefore)

  // Fades on its own, no further user action -- polling the trail's
  // own count reaching zero (a real observable condition) rather than
  // a blind sleep-then-assert.
  await expect(page.getByTestId('atlas-laser-trail')).toHaveCount(0, { timeout: 3_000 })

  // Nothing was ever created to begin with, and the tool stays armed
  // (sticky, like the pencil/eraser) -- there is structurally nothing
  // a reload could read back.
  expect(await page.getByTestId('atlas-note-card').count()).toBe(cardsBefore)
  await expect(laserTool).toHaveAttribute('data-armed', 'true')
})

// Goal 0208 defect 5: a continuous tool has no one-shot commit to
// disarm it (unlike Shape's own goal 0199 behaviour), so Escape is the
// only way out short of clicking the tray again -- pinned for both
// continuous tools this file already covers, distinct from goal 0199's
// own "Escape disarms a LOCKED discrete tool" acceptance.
test('Escape disarms the eraser and the laser back to select', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  const eraserTool = page.getByTestId('atlas-tray-eraser')
  await eraserTool.click()
  await expect(eraserTool).toHaveAttribute('data-armed', 'true')
  await page.keyboard.press('Escape')
  await expect(eraserTool).toHaveAttribute('data-armed', 'false')
  await expect(board).toHaveAttribute('data-armed', 'false')

  const laserTool = page.getByTestId('atlas-tray-laser')
  await laserTool.click()
  await expect(laserTool).toHaveAttribute('data-armed', 'true')
  await page.keyboard.press('Escape')
  await expect(laserTool).toHaveAttribute('data-armed', 'false')
  await expect(board).toHaveAttribute('data-armed', 'false')
})
