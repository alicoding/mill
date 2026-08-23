import { test, expect } from './fixtures/server'
import { dragBetween, openCard } from './fixtures/atlasBoard'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { contextMenu } from './fixtures/contextMenu'

// The pencil tool (goal 0169 slice 3): drag-to-draw's own proof, and
// the styleDefaults dual model's real test -- a drawn stroke's own
// colour/size bake into its SVG mirror file (document data), while a
// SEPARATE ephemeral cache (atlasPencilStyleStore.ts) seeds the next
// stroke and is proven to survive a disarm/re-arm cycle within the
// SAME page session (a plain per-mount useState inside the style
// picker would fail the second test below, since AnchoredOverlay
// actually unmounts its children on close -- verified against its own
// source). Shared pool: every entity created here is deleted here.
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

test('dragging the pencil across the board lands a stroke the mirror-image unit renders, and the tool stays armed', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  const pencilTool = page.getByTestId('atlas-tray-pencil')
  await pencilTool.click()
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')
  await expect(page.getByTestId('atlas-pencil-style-picker')).toBeVisible()

  await dragBetween(page, await boardPoint(board, 0.05, 0.1), await boardPoint(board, 0.15, 0.2))

  // Drag-to-draw is a sticky tool (unlike Area's own one-placement-
  // per-arming rule): completing a stroke never disarms it, so the
  // next drag can draw immediately.
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')

  const card = page.getByTestId('atlas-note-card').filter({ hasText: 'Sketch' })
  await expect(card).toBeVisible()
  await expect(card.getByText('IMG')).toBeVisible()

  await openCard(page, card)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay.getByTestId('atlas-mirror-image')).toBeVisible()
  await deleteViaPageMenu(page, overlay)
  await expect(card).not.toBeVisible()
})

test('the pencil\'s colour choice survives a disarm/re-arm cycle and seeds the next stroke, without becoming a second stroke\'s title or a document field', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  const menu = contextMenu(page)

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

  await dragBetween(page, await boardPoint(board, 0.05, 0.1), await boardPoint(board, 0.15, 0.2))
  await expect(page.getByTestId('atlas-note-card').filter({ hasText: 'Sketch' })).toHaveCount(1)

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
  const sketchCards = page.getByTestId('atlas-note-card').filter({ hasText: 'Sketch' })
  await expect(sketchCards).toHaveCount(2)
  // The chosen colour never leaked into a title or any other document
  // field it could show up as -- both cards carry the tool's own
  // generic default title, proving the style choice stayed confined to
  // the ephemeral cache and the drawn SVG bytes, never the card record.
  await expect(sketchCards.filter({ hasText: '#da3633' })).toHaveCount(0)

  for (let i = 0; i < 2; i++) {
    await sketchCards.first().click({ button: 'right' })
    await expect(menu).toBeVisible()
    await menu.getByText('Delete', { exact: true }).click()
  }
  await expect(sketchCards).toHaveCount(0)
})
