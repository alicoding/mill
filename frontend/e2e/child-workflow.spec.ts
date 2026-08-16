import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import { workflowRow, activePanel, dragPaletteItemToCanvas, connectNodes } from './fixtures/canvas'
import { clickCanvasNode } from './fixtures/canvasNode'

// Exercises ADR-0010's frontend wiring: the child-workflow picker only
// lists workflows rooted in trigger-callable, and selecting one shows a
// binding editor for the child's own declared Attributes. Full
// execution semantics (real DBOS parent/child tracking, idempotency)
// are proven in Go (executionchildworkflow_test.go) against a real DBOS
// instance -- edge-drawing between canvas nodes has no existing
// Playwright coverage anywhere in this repo yet and is real fragility
// to take on separately; this test stays to what's genuinely new
// frontend surface: the picker filter and the binding editor.

async function deleteStarterNode(page: import('@playwright/test').Page) {
  await activePanel(page).locator('.react-flow__node').click()
  await activePanel(page).getByRole('button', { name: 'Delete selected' }).click()
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(0)
}

async function createSingleNodeWorkflow(page: import('@playwright/test').Page, nodeTypeID: string, label: string) {
  await page.getByTestId('new-workflow').click()
  await deleteStarterNode(page)
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, nodeTypeID)
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(1)
  await activePanel(page).getByLabel('Label').fill(label)
  await activePanel(page).getByTestId('save-workflow').click()
  await expect(workflowRow(page, label)).toBeVisible()
}

test('Child Workflow picker only lists workflows rooted in trigger-callable', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  // A default new workflow (trigger-manual root) is NOT a valid child
  // target -- left as-is, no node changes needed.
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByLabel('Label').fill('E2E non-callable')
  await activePanel(page).getByTestId('save-workflow').click()
  await expect(workflowRow(page, 'E2E non-callable')).toBeVisible()

  await createSingleNodeWorkflow(page, 'trigger-callable', 'E2E callable child')

  // Keeps the starter trigger-manual node -- docs/adr/0028 requires a
  // Trigger root now, so "child-workflow" alone (a Process node) can no
  // longer be the whole graph on its own.
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'child-workflow')
  await connectNodes(page, 'Trigger: manual', 'Run another workflow')
  await clickCanvasNode(page, activePanel(page), 'Run another workflow')

  const inspector = activePanel(page).getByTestId('composition-inspector')
  const picker = inspector.getByTestId('entity-ref-field')
  await expect(picker).toBeVisible()
  // The picker's entity list loads asynchronously (ConfigureService/
  // CompositionService.Workflows()) -- wait for it to resolve before
  // reading options, not just for the Select element to be visible.
  await expect(picker.locator('option').first()).not.toHaveText('Loading…')

  const options = await picker.locator('option').allTextContents()
  expect(options.some((o) => o.includes('E2E callable child'))).toBe(true)
  expect(options.some((o) => o.includes('E2E non-callable'))).toBe(false)

  await picker.selectOption({ label: 'E2E callable child' })
  await activePanel(page).getByLabel('Label').fill('E2E parent')
  await activePanel(page).getByTestId('save-workflow').click()
  await expect(workflowRow(page, 'E2E parent')).toBeVisible()

  await clickRowAction(page, workflowRow(page, 'E2E parent'), 'Delete')
  await expect(workflowRow(page, 'E2E parent')).toHaveCount(0)
  await clickRowAction(page, workflowRow(page, 'E2E callable child'), 'Delete')
  await expect(workflowRow(page, 'E2E callable child')).toHaveCount(0)
  await clickRowAction(page, workflowRow(page, 'E2E non-callable'), 'Delete')
  await expect(workflowRow(page, 'E2E non-callable')).toHaveCount(0)
})
