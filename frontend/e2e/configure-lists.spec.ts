import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures/server'
import { addGridColumn } from './fixtures/listGrid'
import { clickCanvasNode } from './fixtures/canvasNode'
import { clickRowAction } from './inventoryRow'
import { workflowRow, activePanel, dragPaletteItemToCanvas, connectNodes } from './fixtures/canvas'

const CSV_FIXTURE = path.join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'list-import-sample.csv')

function listRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText(label, { exact: true }) })
}

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



test('Configuring a typed List: add a column, add a row, both persist', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()

  await page.getByTestId('new-list').click()
  await page.getByLabel('Label').fill('E2E typed list UI')
  await page.getByRole('button', { name: 'Save list' }).click()

  await expect(page.getByTestId('list-rows-editor')).toBeVisible()
  await addGridColumn(page, 'SKU')
  await page.getByTestId('atlas-projection-add-row').click()
  const cell = page.getByTestId('atlas-projection-cell').first()
  await cell.click()
  await page.getByTestId('atlas-projection-cell-input').fill('SKU-1')
  await page.getByTestId('atlas-projection-cell-input').press('Enter')
  await expect(cell).toContainText('SKU-1')

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
  await connectNodes(page, 'Manual run', 'Search list rows')

  await clickCanvasNode(page, panel, 'Search list rows')
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

// docs/adr/0040 decisions 4-5, applied to List by goal 0070, driven end
// to end: Publish freezes an immutable numbered version, shown in the
// edit form's own Versions section -- mirrors decision-outcome.spec.ts's
// identical Decision test.
test('Configure > Lists: Publish freezes a version, shown in the version list', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()

  await page.getByTestId('new-list').click()
  await page.getByLabel('Label').fill('E2E publish list')
  await page.getByRole('button', { name: 'Save list' }).click()
  await addGridColumn(page, 'SKU')

  await expect(page.getByTestId('list-published-badge')).toContainText('Never published')
  await expect(page.getByTestId('list-versions-list')).toHaveCount(0)

  await page.getByTestId('publish-list').click()
  await expect(page.getByTestId('list-published-badge')).toContainText('Published v1')
  await expect(page.getByTestId('list-versions-list')).toContainText('v1')

  // Clean up.
  await page.getByRole('button', { name: 'Close' }).click()
  const row = listRow(page, 'E2E publish list')
  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
})

// docs/goals/0070's CSV import: file -> mapping preview (auto-matched
// "SKU" + a manual remap of "Value" -> "Amount") -> a malformed row
// (a non-numeric Amount) skipped with a reason, shown before AND after
// confirm -> only the valid row actually lands as a real List row.
test('Configure > Lists: CSV import — mapping preview, one manual remap, a malformed row skipped, confirm applies', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()

  await page.getByTestId('new-list').click()
  await page.getByLabel('Label').fill('E2E CSV import list')
  await page.getByRole('button', { name: 'Save list' }).click()
  await expect(page.getByTestId('list-rows-editor')).toBeVisible()
  await addGridColumn(page, 'SKU')
  await addGridColumn(page, 'Amount')
  // The header gear is the column's schema home -- Amount becomes a
  // number column there.
  await page.getByTestId('atlas-projection-header').filter({ hasText: 'Amount' }).hover()
  await page.getByTestId('list-grid-column-settings-amount').click()
  await page.getByTestId('list-grid-column-type').selectOption('number')
  await page.keyboard.press('Escape')

  await page.getByTestId('import-list-rows').click()
  await page.getByTestId('import-list-rows-input').setInputFiles(CSV_FIXTURE)

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const mapping = dialog.getByTestId('import-list-rows-mapping')
  // "SKU" auto-matched the sku column by key -- unchanged.
  await expect(mapping.locator('select').first()).toHaveValue('sku')
  // "Value" has no name alignment with any column -- defaults to
  // "Don't import" until manually remapped.
  await expect(mapping.locator('select').nth(1)).toHaveValue('__skip__')
  await mapping.locator('select').nth(1).selectOption({ label: 'Amount' })

  await expect(dialog.getByTestId('import-list-rows-count')).toContainText('1 row ready to import, 1 skipped')
  const skipped = dialog.getByTestId('import-list-rows-skipped')
  await expect(skipped).toContainText('Row 2')
  await expect(skipped).toContainText('"Amount" must be a number')

  await page.getByRole('button', { name: 'Import 1 row' }).click()
  await expect(dialog).toHaveCount(0)

  // Shown again in the result, not just the preview.
  const result = page.getByTestId('import-list-rows-result')
  await expect(result).toContainText('Imported 1 row.')
  await expect(result).toContainText('Row 2')
  await expect(result).toContainText('"Amount" must be a number')

  // The malformed row never became a real List row -- only the valid one
  // did. TextInput values are DOM `value` attributes, not text nodes.
  await expect(page.getByTestId('atlas-projection-row')).toHaveCount(1)
  await expect(page.getByTestId('atlas-projection-row')).toContainText('WIDGET-1')

  // Clean up.
  await page.getByRole('button', { name: 'Close' }).click()
  const row = listRow(page, 'E2E CSV import list')
  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
})

// docs/goals/0070's write-path seed: the "Example: Track in a list"
// workflow creates a row, then updates that same row in place --
// apply-list-row's key-column matching proven through the real
// guardrail gate + a real ConfigureService-backed List, not a fake.
test('Example: Track in a list runs end to end -- creates then updates the same row by key', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const row = workflowRow(page, 'Example: Track in a list')
  await expect(row).toBeVisible()
  await row.click()

  await activePanel(page).getByTestId('canvas-run').click()
  const bar = activePanel(page).getByTestId('current-step-bar')
  await expect(bar).toContainText('SUCCESS', { timeout: 15_000 })

  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  const trackerRow = listRow(page, 'Example: Task tracker')
  await expect(trackerRow).toBeVisible()
  await trackerRow.click()

  const shippedRow = page.getByTestId('atlas-projection-row').filter({ hasText: 'Ship goal 0070' })
  await expect(shippedRow).toHaveCount(1)
  await expect(shippedRow).toHaveAttribute('data-row-status', 'active')
  await page.getByTestId('configure-lists').getByRole('button', { name: 'Close' }).click()
})

// Grid editing stability (goal 0140): the editor overlays the cell's
// exact box (zero layout shift), boundaries are visible, and the
// spreadsheet keyboard chain works.
test('cell editing never shifts the row, and Tab/Enter walk the grid', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()

  await page.getByTestId('new-list').click()
  await page.getByLabel('Label').fill('E2E keyboard grid')
  await page.getByRole('button', { name: 'Save list' }).click()
  await expect(page.getByTestId('list-rows-editor')).toBeVisible()
  await addGridColumn(page, 'Alpha')
  await addGridColumn(page, 'Beta')
  await page.getByTestId('atlas-projection-add-row').click()
  await page.getByTestId('atlas-projection-add-row').click()

  const firstRow = page.getByTestId('atlas-projection-row').first()
  const boxBefore = await firstRow.boundingBox()
  const firstCell = firstRow.getByTestId('atlas-projection-cell').first()
  await firstCell.click()
  const input = page.getByTestId('atlas-projection-cell-input')
  await expect(input).toBeVisible()

  // Zero layout shift: the row's box is identical while editing.
  const boxDuring = await firstRow.boundingBox()
  expect(boxDuring?.height).toBe(boxBefore?.height)
  expect(boxDuring?.y).toBe(boxBefore?.y)

  // Visible boundary: the cell carries a right border.
  const borderRight = await firstCell.evaluate((el) => getComputedStyle(el).borderRightWidth)
  expect(borderRight).toBe('1px')

  // Keyboard chain: type in A1, Tab -> B1, type, Enter -> B2.
  await input.fill('a1')
  await input.press('Tab')
  await expect(page.getByTestId('atlas-projection-cell-input')).toBeVisible()
  await page.getByTestId('atlas-projection-cell-input').fill('b1')
  await page.getByTestId('atlas-projection-cell-input').press('Enter')
  await expect(page.getByTestId('atlas-projection-cell-input')).toBeVisible()
  await page.getByTestId('atlas-projection-cell-input').press('Escape')

  await expect(firstRow.getByTestId('atlas-projection-cell').nth(0)).toContainText('a1')
  await expect(firstRow.getByTestId('atlas-projection-cell').nth(1)).toContainText('b1')

  // Clean up.
  await page.getByTestId('configure-lists').getByRole('button', { name: 'Close' }).click()
  const row = listRow(page, 'E2E keyboard grid')
  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
})

// Cell focus layer (goal 0143): Escape from an edit lands on the
// CELL; arrows walk cells; Enter re-edits; typing starts a fresh
// edit seeded with the keystroke; Escape again leaves the grid.
test('escape lands on the cell, arrows walk, typing replaces', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()

  await page.getByTestId('new-list').click()
  await page.getByLabel('Label').fill('E2E focus grid')
  await page.getByRole('button', { name: 'Save list' }).click()
  await expect(page.getByTestId('list-rows-editor')).toBeVisible()
  await addGridColumn(page, 'Alpha')
  await addGridColumn(page, 'Beta')
  await page.getByTestId('atlas-projection-add-row').click()

  const firstRow = page.getByTestId('atlas-projection-row').first()
  await firstRow.getByTestId('atlas-projection-cell').first().click()
  await page.getByTestId('atlas-projection-cell-input').press('Escape')
  const focusedCell = page.locator('td[data-focused="true"]')
  await expect(focusedCell).toHaveCount(1)

  await page.keyboard.press('ArrowRight')
  await expect(focusedCell).toHaveAttribute('data-cell', /\|beta$/)

  // Typing seeds a fresh edit with the keystroke.
  await page.keyboard.press('x')
  const input = page.getByTestId('atlas-projection-cell-input')
  await expect(input).toBeVisible()
  await expect(input).toHaveValue('x')
  await input.press('Escape')
  await expect(focusedCell).toHaveCount(1)

  // Enter re-edits the focused cell; Escape twice leaves the grid.
  await page.keyboard.press('Enter')
  await expect(input).toBeVisible()
  await input.press('Escape')
  await page.keyboard.press('Escape')
  await expect(focusedCell).toHaveCount(0)

  // Clean up.
  await page.getByTestId('configure-lists').getByRole('button', { name: 'Close' }).click()
  const row = listRow(page, 'E2E focus grid')
  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
})
