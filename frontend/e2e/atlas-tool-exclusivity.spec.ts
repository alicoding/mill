import { test, expect } from './fixtures/server'
import { contextMenu } from './fixtures/contextMenu'
import { boardPoint, dragBetween } from './fixtures/atlasBoard'

// Goal 0238: at most one canvas tool armed at any time, radio-group
// exclusive like every other canvas app. Traced live (not the goal
// file's own hypothesis): pencil/eraser/laser/card/note/area/shape
// already shared ONE `arm` state in useAtlasCreation.ts before this
// goal, so that pair was never actually reproducible -- the real bug
// crossed a DIFFERENT boundary: Table's own size-picker
// (useTablePickerSignal.ts) and Image's own popover
// (useAtlasImagePopoverSignal.ts) each held a fully independent open
// boolean, so arming pencil then opening either one left BOTH tray
// buttons reading data-armed="true" at once. useAtlasArmedTool.ts now
// gives every arming door -- the 'arm'-kind tools, Table's picker,
// Image's popover -- the exact same shared field, so exclusivity holds
// for the pair the goal named too (pinned below as a same-family
// regression) and for the pair that actually reproduced the defect.
test('arming eraser while pencil is armed disarms pencil (same-family pair)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const pencilTool = page.getByTestId('atlas-tray-pencil')
  const eraserTool = page.getByTestId('atlas-tray-eraser')

  await pencilTool.click()
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')

  await eraserTool.click()
  await expect(eraserTool).toHaveAttribute('data-armed', 'true')
  await expect(pencilTool).toHaveAttribute('data-armed', 'false')
})

// The sticky (pencil, stays armed across strokes)/non-sticky (card,
// disarms after one placement) pair the goal's own acceptance
// criteria names -- both arm through the SAME field regardless of
// their own commit behaviour.
test('arming card while pencil is armed disarms pencil (sticky/non-sticky pair)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const pencilTool = page.getByTestId('atlas-tray-pencil')
  const cardTool = page.getByTestId('atlas-tray-card')

  await pencilTool.click()
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')

  await cardTool.click()
  await expect(cardTool).toHaveAttribute('data-armed', 'true')
  await expect(pencilTool).toHaveAttribute('data-armed', 'false')

  // Cleanup: disarm the card tool rather than placing one.
  await page.keyboard.press('Escape')
  await expect(cardTool).toHaveAttribute('data-armed', 'false')
})

// The actual reproducible mechanism (traced live against unmodified
// code): Table's own picker used to hold a fully independent open
// boolean, so it never disarmed a pencil already armed via
// useAtlasCreation's own (separate) arm state, and vice versa.
test('arming the table picker while pencil is armed disarms pencil, and back again', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const pencilTool = page.getByTestId('atlas-tray-pencil')
  const tableTool = page.getByTestId('atlas-tray-table')

  await pencilTool.click()
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')

  await tableTool.click()
  await expect(tableTool).toHaveAttribute('data-armed', 'true')
  await expect(pencilTool).toHaveAttribute('data-armed', 'false')
  await expect(page.getByTestId('atlas-table-size-2x2')).toBeVisible()

  // Picking a size moves into the placement-pending phase -- still
  // armed as 'table' (the picker popover itself closes), so re-arming
  // pencil now must tear that state down too, not just the popover.
  await page.getByTestId('atlas-table-size-2x2').click()
  await expect(tableTool).toHaveAttribute('data-armed', 'true')

  await pencilTool.click()
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')
  await expect(tableTool).toHaveAttribute('data-armed', 'false')

  // The stale pending table size must be gone, not just visually --
  // a canvas click now draws ink, never places an orphaned table.
  const tableObjects = page.locator('[data-testid="atlas-board-object"][data-object-kind="table"]')
  const inkObjects = page.locator('[data-testid="atlas-board-object"][data-object-kind="ink"]')
  const board = page.getByTestId('atlas-board')
  await dragBetween(page, await boardPoint(board, 0.05, 0.1), await boardPoint(board, 0.15, 0.2))
  await expect(inkObjects).toHaveCount(1)
  await expect(tableObjects).toHaveCount(0)

  await inkObjects.first().click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(inkObjects).toHaveCount(0)
})

// Same cross-family mechanism, the other direction: Image's own
// popover used to hold its own independent open boolean too.
test('arming the image popover while pencil is armed disarms pencil, and back again', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const pencilTool = page.getByTestId('atlas-tray-pencil')
  const imageTool = page.getByTestId('atlas-tray-image')

  await pencilTool.click()
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')

  await imageTool.click()
  await expect(imageTool).toHaveAttribute('data-armed', 'true')
  await expect(pencilTool).toHaveAttribute('data-armed', 'false')

  await pencilTool.click()
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')
  await expect(imageTool).toHaveAttribute('data-armed', 'false')

  await page.keyboard.press('Escape')
  await expect(pencilTool).toHaveAttribute('data-armed', 'false')
})
