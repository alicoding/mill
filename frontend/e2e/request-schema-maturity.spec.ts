import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'

// Exercises docs/SPEC.md §4.1's schema-authoring maturity pass (Phase 1
// of the request-capability-maturity goal): paste-sample field
// inference (genson-js), Default/Description/EnumValues round-tripping
// through the real backend, and the operation-level response extract
// expression -- over real Go bindings (Wails3 server mode), not mocks.

function requestRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="request"]').filter({ has: page.getByText(label, { exact: true }) })
}

async function deleteRequest(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('link', { name: 'Configure' }).click()
  await clickRowAction(page, requestRow(page, label), 'Delete')
  await expect(requestRow(page, label)).toHaveCount(0)
}

test('Paste sample infers output fields, Default/Description/Enum and the response extract expression round-trip through the real backend', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('Schema Maturity Request')
  await page.getByLabel('URL', { exact: true }).fill('https://api.example.com')

  // The manual editor is always visible now, pre-seeded with the
  // request's one implicit operation (the 1:1 model) -- no mode switch,
  // no "Add operation", and Method lives on the request itself, not
  // here (it defaults to GET already).
  const editor = page.getByTestId('manual-schema-editor')
  const operation = editor.getByTestId('manual-operation')
  await operation.getByLabel('Response extract expression').fill('envelope.payload')

  // JSON-sample inference goes through the unified schema intake
  // (SchemaIntake.tsx) -- paste the sample, mark it as a response
  // sample, Load, and the inferred fields land in the editor below.
  await page.getByLabel('Treat JSON sample as').selectOption('response')
  await page.getByTestId('schema-intake-text').fill(JSON.stringify({ name: 'Ada', age: 36 }))
  await page.getByTestId('schema-intake-load').click()
  await expect(page.getByTestId('schema-intake-notice')).toBeVisible()

  // genson-js's createSchema preserves object key insertion order, so
  // the two inferred rows land in the same order as the pasted sample
  // (name, then age) -- positional indexing is simpler and just as
  // reliable here as a value-based filter.
  const outputRows = operation.getByTestId('manual-field-row')
  await expect(outputRows).toHaveCount(2)
  const nameRow = outputRows.nth(0)
  const ageRow = outputRows.nth(1)
  await expect(nameRow.getByLabel('Field name')).toHaveValue('name')
  await expect(ageRow.getByLabel('Field name')).toHaveValue('age')
  await expect(ageRow.getByLabel('Field type')).toHaveValue('integer')

  // Set Default/Description/Enum on the inferred "name" field -- via
  // its popup editor (the pencil) now, not inline row inputs.
  await nameRow.getByTestId('field-edit-open').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Default value').fill('Ada')
  await dialog.getByLabel('Description').fill('widget owner name')
  await dialog.getByLabel('Allowed values').fill('Ada, Bob')
  await dialog.getByTestId('field-edit-done').click()

  await page.getByRole('button', { name: 'Save integration' }).click()

  const row = requestRow(page, 'Schema Maturity Request')
  await expect(row).toBeVisible()
  await row.getByText('Schema Maturity Request', { exact: true }).click()
  await expect(page.getByTestId('request-summary')).toBeVisible()

  // A single declared operation auto-selects, no dropdown to drive
  // (docs/SPEC.md §3.5's "no UI for a decision that doesn't exist").
  const attrPanel = page.getByRole('tabpanel', { name: 'Available attributes' })
  await page.getByRole('tab', { name: 'Available attributes' }).click()

  await expect(attrPanel.getByText('name', { exact: true })).toBeVisible()
  await expect(attrPanel.getByText('default: Ada')).toBeVisible()
  await expect(attrPanel.getByText('enum: Ada, Bob')).toBeVisible()
  await expect(attrPanel.getByText('name: widget owner name')).toBeVisible()
  await expect(attrPanel.getByText('age', { exact: true })).toBeVisible()

  // The response extract expression round-trips through Edit -- the
  // manual editor is the default schema view now, no mode switch.
  await page.getByTestId('summary-edit').click()
  await expect(page.getByLabel('Response extract expression')).toHaveValue('envelope.payload')
  await page.getByRole('button', { name: 'Cancel' }).click()

  await deleteRequest(page, 'Schema Maturity Request')
})
