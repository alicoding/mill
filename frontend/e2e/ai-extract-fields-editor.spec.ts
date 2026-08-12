import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'

// docs/goals/0031-ai-node-family.md: process-ai-extract-structured's
// own output-field editor (AIExtractFieldsEditor.tsx) -- proves a user
// can author a typed output field without touching raw JSON (node-
// standard item 1), and that it round-trips through a real save/reopen
// cycle. Deletes the workflow it creates (shared-settings-file
// accumulation discipline, testing.md).

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(label, { exact: true }) })
}

function activePanel(page: import('@playwright/test').Page) {
  return page.locator('[role="tabpanel"]:not([hidden])').last()
}

async function dragPaletteItemToCanvas(page: import('@playwright/test').Page, nodeTypeID: string) {
  await page.evaluate((id) => {
    const panel = document.querySelector('[role="tabpanel"]:not([hidden])')
    if (!panel) throw new Error('no active tabpanel')
    const palette = panel.querySelector(`[data-node-type-id="${id}"]`)
    const canvas = panel.querySelector('.react-flow__pane')
    if (!palette || !canvas) throw new Error(`drag setup failed: palette found=${!!palette} canvas found=${!!canvas}`)
    const dataTransfer = new DataTransfer()
    const rect = canvas.getBoundingClientRect()
    const clientX = rect.x + rect.width / 2
    const clientY = rect.y + rect.height / 2
    palette.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }))
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }))
  }, nodeTypeID)
}

async function connectNodes(page: import('@playwright/test').Page, sourceLabel: string, targetLabel: string) {
  const panel = activePanel(page)
  await panel.getByRole('button', { name: 'Fit View' }).click()
  await page.waitForTimeout(300)
  const sourceHandle = panel.locator('.react-flow__node').filter({ hasText: sourceLabel }).locator('.react-flow__handle.source')
  const targetHandle = panel.locator('.react-flow__node').filter({ hasText: targetLabel }).locator('.react-flow__handle.target')
  const sourceBox = await sourceHandle.boundingBox()
  const targetBox = await targetHandle.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('connectNodes: handle bounding box not found')
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 })
  await page.mouse.up()
}

async function clickCanvasNode(page: import('@playwright/test').Page, panel: import('@playwright/test').Locator, label: string) {
  const node = panel.locator('.react-flow__node').filter({ hasText: label })
  const box = await node.boundingBox()
  if (!box) throw new Error(`clickCanvasNode: node "${label}" has no bounding box`)
  const candidates = [
    { x: box.x + 10, y: box.y + 10 },
    { x: box.x + box.width - 10, y: box.y + 10 },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    { x: box.x + 10, y: box.y + box.height - 10 },
  ]
  for (const point of candidates) {
    const insideNode = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      return !!el?.closest('.react-flow__node')
    }, point)
    if (insideNode) {
      await page.mouse.click(point.x, point.y)
      return
    }
  }
  throw new Error(`clickCanvasNode: no point for node "${label}" resolved inside its own card`)
}

test('AI: Extract structured data node: adding a typed output field round-trips through save/reopen', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'process-ai-extract-structured')
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(2)
  await connectNodes(page, 'Trigger: manual', 'AI: Extract structured data')
  await clickCanvasNode(page, activePanel(page), 'AI: Extract structured data')

  const inspector = activePanel(page).getByTestId('composition-inspector')
  const editor = inspector.getByTestId('ai-extract-fields-editor')
  await expect(editor).toBeVisible()

  await editor.getByTestId('ai-extract-add-field').click()
  await editor.getByTestId('ai-extract-field-key').fill('amount')
  await editor.getByTestId('ai-extract-field-type').selectOption('number')

  const label = 'E2E AI extract fields test'
  await activePanel(page).getByLabel('Label').fill(label)
  await activePanel(page).getByTestId('save-workflow').click()

  const row = workflowRow(page, label)
  await expect(row).toBeVisible()
  await row.click()

  const panel = activePanel(page)
  await panel.getByRole('button', { name: 'Fit View' }).click()
  await page.waitForTimeout(300)
  await clickCanvasNode(page, panel, 'AI: Extract structured data')
  const reopenedEditor = panel.getByTestId('composition-inspector').getByTestId('ai-extract-fields-editor')
  await expect(reopenedEditor.getByTestId('ai-extract-field-key')).toHaveValue('amount')
  await expect(reopenedEditor.getByTestId('ai-extract-field-type')).toHaveValue('number')

  await page.getByRole('link', { name: 'Workflows' }).click()
  await clickRowAction(page, row, 'Delete')
  await expect(workflowRow(page, label)).toHaveCount(0)
})
