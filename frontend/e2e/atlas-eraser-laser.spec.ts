import { test, expect } from './fixtures/server'
import { boardPoint, dragBetween, createCardViaTray, noteCard, deleteCardViaMenu } from './fixtures/atlasBoard'
import { contextMenu } from './fixtures/contextMenu'
import { blurSticky, fillSticky, stickyEditor } from './fixtures/codeEditor'

function boardObjects(page: import('@playwright/test').Page, kind: string) {
  return page.locator(`[data-testid="atlas-board-object"][data-object-kind="${kind}"]`)
}

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

// Regression (goal 0230): board-object hit-testing (ink/shape/image/
// table/diagram) was never wired into the gesture engine's ctx
// (AtlasGestureCtx.objectBoxes) -- eraserTool.ts's own onPoint only
// ever tested cardBoxes/noteBoxes, so dragging across an ink stroke
// deleted nothing regardless of where it landed. Fixed at the ctx seam
// (AtlasBoard.tsx now derives objectBoxes off React Flow's own
// measured node state, the same source AtlasLinkEdge.tsx already reads
// for floating-edge geometry) rather than a bespoke eraser-only lookup.
test('dragging the eraser across an ink stroke removes it, and the quick-delete undo toast brings it back', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  await page.getByTestId('atlas-tray-pencil').click()
  await dragBetween(page, await boardPoint(board, 0.05, 0.1), await boardPoint(board, 0.15, 0.2))
  const ink = boardObjects(page, 'ink')
  await expect(ink).toHaveCount(1)
  const box = await ink.first().boundingBox()
  if (!box) throw new Error('ink stroke has no bounding box')

  const eraserTool = page.getByTestId('atlas-tray-eraser')
  await eraserTool.click()
  await expect(eraserTool).toHaveAttribute('data-armed', 'true')

  await dragBetween(
    page,
    { x: box.x - 20, y: box.y + box.height / 2 },
    { x: box.x + box.width + 20, y: box.y + box.height / 2 },
  )
  await expect(ink).toHaveCount(0)

  const undoToast = page.getByTestId('atlas-undo-toast')
  await expect(undoToast).toBeVisible()
  await page.getByTestId('atlas-undo-toast-button').click()
  await expect(ink).toHaveCount(1)

  await ink.first().click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(ink).toHaveCount(0)
})

test('dragging the eraser across an ink stroke removes it, and ⌘Z brings it back', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  await page.getByTestId('atlas-tray-pencil').click()
  await dragBetween(page, await boardPoint(board, 0.05, 0.1), await boardPoint(board, 0.15, 0.2))
  const ink = boardObjects(page, 'ink')
  await expect(ink).toHaveCount(1)
  const box = await ink.first().boundingBox()
  if (!box) throw new Error('ink stroke has no bounding box')

  const eraserTool = page.getByTestId('atlas-tray-eraser')
  await eraserTool.click()
  await expect(eraserTool).toHaveAttribute('data-armed', 'true')

  await dragBetween(
    page,
    { x: box.x - 20, y: box.y + box.height / 2 },
    { x: box.x + box.width + 20, y: box.y + box.height / 2 },
  )
  await expect(ink).toHaveCount(0)

  await page.keyboard.press('Meta+z')
  await expect(ink).toHaveCount(1)

  await ink.first().click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(ink).toHaveCount(0)
})

// Kind-coverage matrix (goal 0230 contract item 3): one erasable kind
// per assertion, each created then swept away by its own eraser drag,
// so a future ctx change dropping a box set again fails loudly instead
// of silently -- the exact way this regression shipped unnoticed
// (atlas-eraser-laser.spec.ts ran green throughout because it only
// ever exercised cards).
test('the eraser removes every erasable kind: ink, shape, image, card, note', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  async function eraseBox(box: { x: number; y: number; width: number; height: number }) {
    // Shape is a DISCRETE tool (goal 0199 part D): its own completed
    // draw disarms it and leaves the new object selected, which swaps
    // the creation tray for the selection tray (AtlasBoard.tsx) -- the
    // eraser button lives only in the former. Escape's own ladder
    // (useAtlasSelectionTray.ts) clears a live selection first, a
    // harmless no-op for the sticky tools that never select on
    // creation.
    await page.keyboard.press('Escape')
    const eraserTool = page.getByTestId('atlas-tray-eraser')
    await eraserTool.click()
    await expect(eraserTool).toHaveAttribute('data-armed', 'true')
    await dragBetween(
      page,
      { x: box.x - 20, y: box.y + box.height / 2 },
      { x: box.x + box.width + 20, y: box.y + box.height / 2 },
    )
  }

  // Ink.
  await page.getByTestId('atlas-tray-pencil').click()
  await dragBetween(page, await boardPoint(board, 0.05, 0.1), await boardPoint(board, 0.15, 0.2))
  const ink = boardObjects(page, 'ink')
  await expect(ink).toHaveCount(1)
  const inkBox = await ink.first().boundingBox()
  if (!inkBox) throw new Error('ink stroke has no bounding box')
  await eraseBox(inkBox)
  await expect(ink).toHaveCount(0)

  // Shape.
  await page.getByTestId('atlas-tray-shape').click()
  await dragBetween(page, await boardPoint(board, 0.3, 0.1), await boardPoint(board, 0.4, 0.2))
  const shape = boardObjects(page, 'shape')
  await expect(shape).toHaveCount(1)
  const shapeBox = await shape.first().boundingBox()
  if (!shapeBox) throw new Error('shape has no bounding box')
  await eraseBox(shapeBox)
  await expect(shape).toHaveCount(0)

  // Image (goal 0206's native-picker bypass -- every worker's server
  // returns the same fixture file regardless of path).
  await page.getByTestId('atlas-tray-image').click()
  await expect(page.getByTestId('atlas-image-input')).toBeVisible()
  await page.getByTestId('atlas-image-pick').click()
  const image = boardObjects(page, 'image')
  await expect(image).toHaveCount(1)
  const imageBox = await image.first().boundingBox()
  if (!imageBox) throw new Error('image has no bounding box')
  await eraseBox(imageBox)
  await expect(image).toHaveCount(0)

  // Card.
  await createCardViaTray(page, 'ZzEraserCoverageCard')
  const card = noteCard(page, 'ZzEraserCoverageCard')
  await expect(card).toBeVisible()
  const cardBox = await card.boundingBox()
  if (!cardBox) throw new Error('card has no bounding box')
  await eraseBox(cardBox)
  await expect(card).toHaveCount(0)

  // Note (sticky). Placed in the same clear top-left band the ink/
  // shape strokes above already proved empty -- clickCorner's own
  // top-right sits against the board chrome/minimap (clipped the
  // rendered box), and the board's own mid-right area is seeded
  // content ("The engagement" cluster), not empty pane.
  await page.getByTestId('atlas-tray-note').click()
  const notePlacement = await boardPoint(board, 0.1, 0.15)
  await board.click({ position: notePlacement.position })
  await expect(stickyEditor(page)).toBeVisible()
  await fillSticky(page, 'ZzEraserCoverageNote')
  await blurSticky(page)
  const note = page.getByTestId('atlas-sticky-note').filter({ hasText: 'ZzEraserCoverageNote' })
  await expect(note).toBeVisible()
  const noteBox = await note.boundingBox()
  if (!noteBox) throw new Error('note has no bounding box')
  await eraseBox(noteBox)
  await expect(note).toHaveCount(0)
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
