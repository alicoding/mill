import { test, expect } from './fixtures/server'
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

  const codeRow = page.getByTestId('list-column-row').first()
  const deprecatedRow = page.getByTestId('list-column-row').nth(2)
  await expect(deprecatedRow.getByTestId('list-column-key')).toHaveValue('legacyRegion')
  await expect(deprecatedRow.getByRole('checkbox', { name: 'Mark this column deprecated' })).toBeChecked()
  // De-emphasized: a computed-style check (testing.md's interaction-e2e
  // guidance), not a screenshot -- the deprecated row's own text color
  // differs from an ordinary (non-deprecated) row's.
  const codeColor = await codeRow.evaluate((el) => getComputedStyle(el).color)
  const deprecatedColor = await deprecatedRow.evaluate((el) => getComputedStyle(el).color)
  expect(deprecatedColor).not.toBe(codeColor)

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
  await connectNodes(page, 'Trigger: manual', 'List: search')

  await clickCanvasNode(page, panel, 'List: search')
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
  await page.getByTestId('list-column-key').fill('code')
  await page.getByRole('button', { name: 'Save list' }).click()

  await expect(page.getByTestId('list-rows-editor')).toBeVisible()
  await page.getByTestId('add-list-row').click()
  const row = page.getByTestId('list-row')
  await row.getByRole('textbox').fill('KEEP-ME')
  await row.getByTestId('save-list-row').click()

  // Delete the saved column -- a confirm names it and states data is
  // preserved, distinct from the earlier draft-row remove (no confirm
  // needed) proven by configure-lists.spec.ts's own column editor test.
  const columnRow = page.getByTestId('list-column-row').first()
  await columnRow.getByRole('button', { name: 'Remove column' }).click()
  const confirmDialog = page.getByRole('alertdialog')
  await expect(confirmDialog).toContainText('code')
  await confirmDialog.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Save list' }).click()

  // Re-add the same key at the same type -- a legal resurrect
  // (typedfield.ValidateFieldEvolution) -- and the row's own value for
  // it is still there, never wiped by the delete.
  await page.getByRole('button', { name: 'Add column' }).click()
  await page.getByTestId('list-column-key').last().fill('code')
  await page.getByRole('button', { name: 'Save list' }).click()
  await expect(row.getByRole('textbox')).toHaveValue('KEEP-ME')

  // Clean up.
  await page.getByRole('button', { name: 'Close' }).click()
  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('E2E tombstone list UI', { exact: true }) })
  await clickRowAction(page, listRow, 'Delete')
  await expect(listRow).toHaveCount(0)
})
