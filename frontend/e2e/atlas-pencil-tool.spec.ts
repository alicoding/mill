import { test, expect } from './fixtures/server'
import { dragBetween } from './fixtures/atlasBoard'
import { contextMenu } from './fixtures/contextMenu'
import { ATLAS_KIND_TOPIC, selectKind } from './fixtures/kindPicker'

// The pencil tool (goal 0169 slice 3, re-pointed by goal 0179 S1's own
// correction): drag-to-draw lands ink as a board-local BoardObject --
// NEVER a card, and NEVER a commit ceremony that interrupts drawing.
// Consecutive strokes each add another ink object without disarming
// the tool; a stroke never opens a page, never gets a title, and
// "Promote to card…" is the one explicit, one-way escape hatch out of
// board-local. Shared pool: every entity created here is deleted here.
//
// Real pointer-capture drag, not React Flow's own internal drag
// machinery (the class QUARANTINE.md's box-select/NodeResizer entries
// document as unreliable to synthesize): this hook is wired the exact
// same way the Area tool's own marquee draw is
// (onPointerDownCapture/MoveCapture/UpCapture on an ANCESTOR of React
// Flow's pane), which atlas-containment.spec.ts already proves
// reliably synthesizable via page.mouse -- dense intermediate moves,
// not React Flow's own delta-sampled drag tracking.
async function boardPoint(board: import('@playwright/test').Locator, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const box = await board.boundingBox()
  if (!box) throw new Error('board has no bounding box')
  return { x: box.x + box.width * fx, y: box.y + box.height * fy }
}

function inkObjects(page: import('@playwright/test').Page) {
  return page.locator('[data-testid="atlas-board-object"][data-object-kind="ink"]')
}

test('dragging the pencil across the board lands ink, never a card, and the tool stays armed for the next stroke', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  const pencilTool = page.getByTestId('atlas-tray-pencil')
  await pencilTool.click()
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')
  await expect(page.getByTestId('atlas-pencil-style-picker')).toBeVisible()

  await dragBetween(page, await boardPoint(board, 0.05, 0.1), await boardPoint(board, 0.15, 0.2))

  const ink = inkObjects(page)
  await expect(ink).toHaveCount(1)
  // The rule, absolute: drawing never creates a card the user didn't
  // explicitly ask for -- checked against the title a stroke would
  // have produced had it (wrongly) landed as a card, not a blanket
  // zero (the seeded example space already carries its own cards).
  await expect(page.getByTestId('atlas-note-card').filter({ hasText: 'Sketch' })).toHaveCount(0)

  // Drag-to-draw is a sticky tool (unlike Area's own one-placement-
  // per-arming rule): completing a stroke never disarms it, so a
  // second stroke draws immediately and lands as its OWN object --
  // consecutive strokes never merge or interrupt each other.
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')
  await dragBetween(page, await boardPoint(board, 0.3, 0.1), await boardPoint(board, 0.4, 0.2))
  await expect(ink).toHaveCount(2)

  // Promote to card (explicit, one-way): the baked SVG stroke becomes
  // a real mirror-image card.
  await ink.first().click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Promote to card…', { exact: true }).click()
  const popover = page.getByTestId('atlas-placement-popover')
  await expect(popover).toBeVisible()
  await expect(popover.getByTestId('atlas-placement-title')).toHaveValue('Sketch')
  await selectKind(popover, ATLAS_KIND_TOPIC)
  await popover.getByTestId('atlas-placement-submit').click()
  await expect(popover).not.toBeVisible()
  await expect(ink).toHaveCount(1)
  const card = page.getByTestId('atlas-note-card').filter({ hasText: 'Sketch' })
  await expect(card).toBeVisible()
  await expect(card.getByText('IMG')).toBeVisible()

  // Clean up: the promoted card, then the remaining ink object.
  await card.click({ button: 'right' })
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(card).toHaveCount(0)

  await ink.click({ button: 'right' })
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(ink).toHaveCount(0)
})

test('the pencil\'s colour choice survives a disarm/re-arm cycle and seeds the next stroke', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  const pencilTool = page.getByTestId('atlas-tray-pencil')
  await pencilTool.click()
  const picker = page.getByTestId('atlas-pencil-style-picker')
  await expect(picker).toBeVisible()

  // The default colour is the first swatch -- pick a DIFFERENT one so
  // a regression back to the default would be visible.
  const chosenSwatch = picker.getByTestId('atlas-pencil-color-da3633')
  await expect(chosenSwatch).toHaveAttribute('data-selected', 'false')
  await chosenSwatch.click()
  await expect(chosenSwatch).toHaveAttribute('data-selected', 'true')

  const ink = inkObjects(page)
  await dragBetween(page, await boardPoint(board, 0.05, 0.1), await boardPoint(board, 0.15, 0.2))
  await expect(ink).toHaveCount(1)

  // Disarm, then re-arm: the style picker REMOUNTS (AnchoredOverlay
  // unmounts its children while closed) -- the swatch selection
  // surviving this proves it lives in the ephemeral store, not
  // per-mount component state.
  await pencilTool.click()
  await expect(picker).not.toBeVisible()
  await pencilTool.click()
  await expect(picker).toBeVisible()
  await expect(picker.getByTestId('atlas-pencil-color-da3633')).toHaveAttribute('data-selected', 'true')

  await dragBetween(page, await boardPoint(board, 0.3, 0.1), await boardPoint(board, 0.4, 0.2))
  await expect(ink).toHaveCount(2)

  for (let i = 0; i < 2; i++) {
    await ink.first().click({ button: 'right' })
    const menu = contextMenu(page)
    await expect(menu).toBeVisible()
    await menu.getByText('Delete', { exact: true }).click()
  }
  await expect(ink).toHaveCount(0)
})
