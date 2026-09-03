import { test, expect } from './fixtures/server'
import { clickGlideCell, editGlideCell, glideCellText } from './fixtures/glideGrid'
import { addGridColumn } from './fixtures/listGrid'
import { clickRowAction } from './inventoryRow'
import { activePanel, dragPaletteItemToCanvas, connectNodes } from './fixtures/canvas'
import { clickCanvasNode } from './fixtures/canvasNode'

// docs/adr/0040 slice 1 (goal 0046): the live-app proof for the three
// decisions this slice ships -- Field.Key immutability (server-side,
// proven at the Go layer's own service tests, not re-proven here),
// Deprecated fields (de-emphasized + excluded from new bindings, never
// existing ones), and field/entity delete integrity (a tombstoned
// field delete confirms and preserves data; a still-referenced entity
// delete is blocked, naming the workflow).
//
// The seeded "Example: Country codes" List carries a real Deprecated
// column (legacyRegion, internal/domain/list/builtin.go) and is
// referenced by two seeded workflows -- both properties this spec
// exercises live rather than through a purpose-built fixture, per
// testing.md's "the seed IS the proof" bar. Nothing here deletes that
// seed; the block test asserts the block itself and never proceeds to
// an actual delete, so the seed stays intact for every other spec
// sharing this worker's server.

test('Deprecated column: de-emphasized in the List editor and excluded from a new list-search match parameter', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()

  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('Example: Country codes', { exact: true }) })
  await listRow.getByText('Example: Country codes', { exact: true }).click()

  // The grid publishes which columns are deprecated (the header paint
  // is the library's; the muted header theme was screenshot-reviewed).
  const glide = page.getByTestId('atlas-projection-glide')
  await expect(glide).toHaveAttribute('data-col-deprecated', /.+/)
  const deprecatedKey = (await glide.getAttribute('data-col-deprecated')) ?? ''
  const deprecatedIndex = ((await glide.getAttribute('data-col-keys')) ?? '').split(',').indexOf(deprecatedKey)
  expect(deprecatedIndex).toBeGreaterThanOrEqual(0)
  // The popover shows the stored deprecation for that column.
  await clickGlideCell(page, glide, -1, deprecatedIndex, { button: 'right' })
  await page.getByTestId(`list-grid-column-settings-${deprecatedKey}`).click()
  await expect(page.getByTestId('list-grid-column-deprecated')).toBeChecked()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Close' }).click()

  // A fresh list-search node's match-parameter picker offers Code/Name
  // but never the deprecated column -- excluded from a NEW binding,
  // never from data already bound to it (this is a fresh param, so
  // nothing is bound yet).
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  const panel = activePanel(page)
  await panel.getByLabel('Label').fill('E2E deprecated column picker test')

  await panel.getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'list-search')
  await expect(panel.locator('.react-flow__node')).toHaveCount(2)
  await connectNodes(page, 'Manual run', 'Search list rows')

  await clickCanvasNode(page, panel, 'Search list rows')
  const inspector = panel.getByTestId('composition-inspector')
  await inspector.getByTestId('entity-ref-field').selectOption({ label: 'Example: Country codes' })

  const editor = inspector.getByTestId('list-search-params-editor')
  await editor.getByTestId('add-list-search-param').click()
  const columnOptions = await editor.getByTestId('list-search-param-column').locator('option').allTextContents()
  expect(columnOptions).toContain('Code')
  expect(columnOptions).toContain('Name')
  expect(columnOptions).not.toContain('Region (legacy)')

  // Nothing was ever Saved, so there's nothing persisted to clean up --
  // a hard navigation discards the in-memory draft outright, no
  // close-guard interaction needed.
  await page.goto('/')
})

test('Deleting a still-referenced List is blocked, naming the workflows', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()

  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('Example: Country codes', { exact: true }) })
  await expect(listRow).toBeVisible()

  await clickRowAction(page, listRow, 'Delete')

  const error = page.getByTestId('import-list-error')
  await expect(error).toBeVisible()
  await expect(error).toContainText('still referenced by workflow')
  await expect(error).toContainText('Example: Country code lookup')

  // Blocked, not deleted -- the row is still there for every other
  // spec sharing this worker's server.
  await expect(listRow).toBeVisible()
})

test('Deleting a saved column tombstones it (confirmed); re-adding the same key/type resurrects the row\'s own data', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()

  await page.getByTestId('new-list').click()
  await page.getByLabel('Label').fill('E2E tombstone list UI')
  await page.getByRole('button', { name: 'Save list' }).click()

  await expect(page.getByTestId('list-rows-editor')).toBeVisible()
  await addGridColumn(page, 'Code')
  await page.getByTestId('atlas-projection-add-row').click()
  const glide = page.getByTestId('atlas-projection-glide')
  await editGlideCell(page, glide, 0, 0, 'KEEP-ME')
  await expect(glideCellText(glide, 0, 0)).toHaveText('KEEP-ME')

  // Remove the saved column via the header menu -- a confirm names it
  // and states data is preserved.
  await clickGlideCell(page, glide, -1, 0, { button: 'right' })
  await page.getByTestId('list-grid-column-settings-code').click()
  await page.getByTestId('list-grid-column-remove').click()
  const confirmDialog = page.getByRole('alertdialog')
  await expect(confirmDialog).toContainText('Code')
  await confirmDialog.getByRole('button', { name: 'Remove column' }).click()
  await expect(glide).toHaveAttribute('data-columns', '0')

  // Re-add the same key at the same type (naming a fresh empty column
  // "Code" re-keys it to code) -- a legal resurrect
  // (typedfield.ValidateFieldEvolution) -- and the row's own value for
  // it is still there, never wiped by the delete.
  await addGridColumn(page, 'Code')
  await expect(glideCellText(glide, 0, 0)).toHaveText('KEEP-ME')

  // Clean up.
  await page.getByRole('button', { name: 'Close' }).click()
  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('E2E tombstone list UI', { exact: true }) })
  await clickRowAction(page, listRow, 'Delete')
  await expect(listRow).toHaveCount(0)
})
