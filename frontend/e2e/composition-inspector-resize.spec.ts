// The canvas | inspector split (goal 0304): the inspector is a
// resizable panel -- drag its separator to widen it, double-click the
// separator to reset, the chosen width survives a reload on this
// device, and nothing selected collapses it. Shared worker pool: the
// workflow draft is never saved, and the remembered width lives in
// this test's own browser context.
import { test, expect } from './fixtures/server'
import { activePanel, dragPaletteItemToCanvas } from './fixtures/canvas'
import { clickCanvasNode } from './fixtures/canvasNode'
import { dragBetween } from './fixtures/atlasBoard'

async function openDraftWithSelection(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'apply-clipboard-write-html')
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(2)
  await clickCanvasNode(page, activePanel(page), 'Write HTML to clipboard')
  const inspector = activePanel(page).getByTestId('composition-inspector')
  await expect(inspector).toContainText('Write HTML to clipboard')
  return inspector
}

async function widthOf(locator: import('@playwright/test').Locator): Promise<number> {
  const box = await locator.boundingBox()
  return box ? box.width : 0
}

test('the inspector resizes by its separator, resets on double-click, remembers its width, and collapses without a selection', async ({ page }) => {
  const inspector = await openDraftWithSelection(page)
  const separator = activePanel(page).getByRole('separator', { name: 'Resize the inspector' })
  await expect(separator).toBeVisible()
  await expect.poll(() => widthOf(inspector)).toBeGreaterThan(250)
  const initial = await widthOf(inspector)
  const shot = async (name: string) => { if (process.env.MILL_E2E_SHOT_DIR) await page.screenshot({ path: `${process.env.MILL_E2E_SHOT_DIR}/inspector-${name}.png` }) }
  await shot('default')

  // Drag the separator 160px to the left: the inspector grows by that much.
  const sepBox = await separator.boundingBox()
  if (!sepBox) throw new Error('separator has no bounding box')
  const y = sepBox.y + sepBox.height / 2
  await dragBetween(page, { x: sepBox.x + sepBox.width / 2, y }, { x: sepBox.x - 160, y })
  await expect.poll(() => widthOf(inspector)).toBeGreaterThan(initial + 120)
  const widened = await widthOf(inspector)

  // The chosen width is this device's: a reload and a fresh selection
  // land on it again.
  await page.reload()
  await openDraftWithSelection(page)
  await expect.poll(() => widthOf(activePanel(page).getByTestId('composition-inspector'))).toBeGreaterThan(widened - 12)

  // Double-clicking the separator resets to the default width.
  await activePanel(page).getByRole('separator', { name: 'Resize the inspector' }).dblclick()
  await expect.poll(() => widthOf(activePanel(page).getByTestId('composition-inspector'))).toBeLessThan(widened - 100)

  // Expand widens the inspector to its ceiling; Shrink returns it.
  // The ceiling is 60% of the canvas | inspector group (the palette
  // beside it is not part of the split).
  const groupWidth = await widthOf(activePanel(page).locator('[data-group]').first())
  const beforeExpand = await widthOf(activePanel(page).getByTestId('composition-inspector'))
  await activePanel(page).getByTestId('composition-inspector-expand').click()
  await expect.poll(() => widthOf(activePanel(page).getByTestId('composition-inspector'))).toBeGreaterThan(groupWidth * 0.55)
  await expect(activePanel(page).getByRole('button', { name: 'Shrink the inspector' })).toBeVisible()
  await shot('expanded')
  await activePanel(page).getByTestId('composition-inspector-expand').click()
  await expect.poll(() => widthOf(activePanel(page).getByTestId('composition-inspector'))).toBeLessThan(beforeExpand + 12)

  // Deselecting collapses the panel entirely -- the canvas takes the room.
  // Mid-left of the pane: clear of the top-left toolbar and the
  // bottom-left controls.
  const pane = activePanel(page).locator('.react-flow__pane')
  const paneBox = await pane.boundingBox()
  if (!paneBox) throw new Error('pane has no bounding box')
  await pane.click({ position: { x: 24, y: paneBox.height / 2 } })
  await expect(activePanel(page).locator('.react-flow__node.selected')).toHaveCount(0)
  await expect(activePanel(page).getByTestId('composition-inspector')).toHaveCount(0)
  await shot('collapsed')
  await expect(activePanel(page).getByRole('separator', { name: 'Resize the inspector' })).toHaveCount(0)
})
