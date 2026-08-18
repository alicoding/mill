import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import { workflowRow, activePanel, dragPaletteItemToCanvas, connectNodes } from './fixtures/canvas'
import { clickCanvasNode } from './fixtures/canvasNode'
import { waitForViewportStable } from './fixtures/animation'

// docs/goals/0031-ai-node-family.md: process-ai-extract-structured's
// own output-field editor (AIExtractFieldsEditor.tsx) -- proves a user
// can author a typed output field without touching raw JSON (node-
// standard item 1), and that it round-trips through a real save/reopen
// cycle. Deletes the workflow it creates (shared-settings-file
// accumulation discipline, testing.md).

test('Extract fields with AI node: adding a typed output field round-trips through save/reopen', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'process-ai-extract-structured')
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(2)
  await connectNodes(page, 'Manual run', 'Extract fields with AI')
  await clickCanvasNode(page, activePanel(page), 'Extract fields with AI')

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
  await waitForViewportStable(panel)
  await clickCanvasNode(page, panel, 'Extract fields with AI')
  const reopenedEditor = panel.getByTestId('composition-inspector').getByTestId('ai-extract-fields-editor')
  await expect(reopenedEditor.getByTestId('ai-extract-field-key')).toHaveValue('amount')
  await expect(reopenedEditor.getByTestId('ai-extract-field-type')).toHaveValue('number')

  await page.getByRole('link', { name: 'Workflows' }).click()
  await clickRowAction(page, row, 'Delete')
  await expect(workflowRow(page, label)).toHaveCount(0)
})
