import { test, expect } from './fixtures/server'
import { clickCanvasNode } from './fixtures/canvasNode'
import { clickRowAction } from './inventoryRow'

// docs/goals/0011-lists-maturation.md: exercises the typed List
// Configure UI (column schema editor + schema-generated row editor,
// ConfigureLists.tsx) and the list-search node's own Inspector
// (ListSearchParamsEditor.tsx, a column picker + literal-or-attribute
// value + exact/fuzzy match type) built live through the canvas --
// not just against the hardcoded seed (seed-completeness.spec.ts
// already covers running the seed). Deletes the workflow it creates,
// same shared-settings-file discipline every other spec here follows;
// reuses the seeded "Example: Country codes" List rather than
// creating a second one, so there's nothing List-shaped to clean up.

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
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

test('Configuring a typed List: add a column, add a row, both persist', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()

  await page.getByTestId('new-list').click()
  await page.getByLabel('Label').fill('E2E typed list UI')
  await page.getByTestId('list-column-key').fill('sku')
  await page.getByRole('button', { name: 'Save list' }).click()

  await expect(page.getByTestId('list-rows-editor')).toBeVisible()
  await page.getByTestId('add-list-row').click()
  const row = page.getByTestId('list-row')
  await expect(row).toBeVisible()
  await row.getByRole('textbox').fill('SKU-1')
  await row.getByTestId('save-list-row').click()

  await page.getByRole('button', { name: 'Close' }).click()
  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('E2E typed list UI', { exact: true }) })
  await expect(listRow).toBeVisible()
  await expect(listRow).toContainText('1 columns, 1 rows')

  // Clean up.
  await clickRowAction(page, listRow, 'Delete')
  await expect(listRow).toHaveCount(0)
})

test('list-search node: configuring a real match parameter through the Inspector, then running it end to end', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  const panel = activePanel(page)
  await panel.getByLabel('Label').fill('E2E list-search config test')

  // Deliberately no apply-clipboard-write-text terminal node -- this
  // test proves the list-search Inspector's own authoring/execution,
  // not clipboard I/O, and a clipboard apply step has no clipboard on
  // a headless Linux CI runner (docs/SPEC.md §1.3; the same fix
  // applied to the seeded "Example: Country lookup (search)" workflow
  // after a real CI failure, builtinworkflows_list.go). Ending at
  // list-search itself is an accepted, warn-only Process leaf
  // (ADR-0028).
  await panel.getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'list-search')
  await expect(panel.locator('.react-flow__node')).toHaveCount(2)
  await connectNodes(page, 'Trigger: manual', 'List: search')

  await clickCanvasNode(page, panel, 'List: search')
  const inspector = panel.getByTestId('composition-inspector')

  // Pick the seeded typed List via the live entity picker (ADR-0009).
  await inspector.getByTestId('entity-ref-field').selectOption({ label: 'Example: Country codes' })

  const editor = inspector.getByTestId('list-search-params-editor')
  await expect(editor).toBeVisible()
  await editor.getByTestId('add-list-search-param').click()
  // The column Select now offers the real List's own columns (code, name).
  await editor.getByTestId('list-search-param-column').selectOption({ label: 'Code' })
  await editor.getByLabel('Value literal value').fill('US')

  // outputAttribute is a plain generic ConfigField (not owned by the
  // bespoke editor) -- filled via its own normal labeled text input.
  await inspector.getByLabel('Output attribute').fill('searchResult')

  await panel.getByTestId('save-workflow').click()

  const row = workflowRow(page, 'E2E list-search config test')
  await expect(row).toBeVisible()
  await row.click()

  // Manual trigger, no declared Attributes -- Run fires immediately,
  // no test-input dialog (docs/adr/0008 only opens one when Attributes
  // are declared).
  await activePanel(page).getByTestId('canvas-run').click()
  const bar = activePanel(page).getByTestId('current-step-bar')
  await expect(bar).toContainText('SUCCESS', { timeout: 15_000 })

  // Clean up.
  await page.getByRole('link', { name: 'Workflows' }).click()
  const wfRow = workflowRow(page, 'E2E list-search config test')
  await clickRowAction(page, wfRow, 'Delete')
  await expect(wfRow).toHaveCount(0)
})
