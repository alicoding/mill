import { test, expect } from '@playwright/test'

// Exercises ADR-0010's frontend wiring: the child-workflow picker only
// lists workflows rooted in trigger-callable, and selecting one shows a
// binding editor for the child's own declared Attributes. Full
// execution semantics (real DBOS parent/child tracking, idempotency)
// are proven in Go (executionchildworkflow_test.go) against a real DBOS
// instance -- edge-drawing between canvas nodes has no existing
// Playwright coverage anywhere in this repo yet and is real fragility
// to take on separately; this test stays to what's genuinely new
// frontend surface: the picker filter and the binding editor.

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="workflow-row"]', { has: page.getByText(label, { exact: true }) })
}

// .last(), not a bare match: a saved workflow's editor tab now nests a
// second Canvas/Runs tab bar inside the outer per-workflow tab
// (docs/SPEC.md §7's Update), so up to two [role="tabpanel"]:not([hidden])
// elements can be visible at once (the outer workflow tab, the inner
// Canvas/Runs one) -- document order always puts the outer one first,
// so .last() reliably resolves to the innermost, most specific panel
// regardless of whether a workflow has an inner tab bar or not.
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

  await page.getByTestId('new-workflow').click()
  await deleteStarterNode(page)
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'child-workflow')
  await activePanel(page).locator('.react-flow__node').click()

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

  await workflowRow(page, 'E2E parent').getByRole('button', { name: /Delete/ }).click()
  await expect(workflowRow(page, 'E2E parent')).toHaveCount(0)
  await workflowRow(page, 'E2E callable child').getByRole('button', { name: /Delete/ }).click()
  await expect(workflowRow(page, 'E2E callable child')).toHaveCount(0)
  await workflowRow(page, 'E2E non-callable').getByRole('button', { name: /Delete/ }).click()
  await expect(workflowRow(page, 'E2E non-callable')).toHaveCount(0)
})
