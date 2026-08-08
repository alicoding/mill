import { test, expect } from '@playwright/test'

// Exercises docs/SPEC.md §4.1's schema-authoring maturity pass (Phase 1
// of the connector-capability-maturity goal): paste-sample field
// inference (genson-js), Default/Description/EnumValues round-tripping
// through the real backend, and the operation-level response extract
// expression -- over real Go bindings (Wails3 server mode), not mocks.

function connectorRow(page: import('@playwright/test').Page, label: string) {
  return page.getByTestId('connector-row').filter({ has: page.getByText(label, { exact: true }) })
}

async function deleteConnector(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('tab', { name: 'Connectors' }).click()
  await connectorRow(page, label).getByRole('button', { name: `Delete ${label}` }).click()
  await expect(connectorRow(page, label)).toHaveCount(0)
}

test('Paste sample infers output fields, Default/Description/Enum and the response extract expression round-trip through the real backend', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-connector').click()
  await page.getByLabel('Label').fill('Schema Maturity Connector')
  await page.getByLabel('Base URL').fill('https://api.example.com')

  await page.getByRole('button', { name: 'Manual editor' }).click()
  const editor = page.getByTestId('manual-schema-editor')
  await editor.getByTestId('add-operation').click()
  const operation = editor.getByTestId('manual-operation')
  await operation.getByLabel('Method').selectOption('GET')
  await operation.getByLabel('Path').fill('/widgets')
  await operation.getByLabel('Response extract expression').fill('envelope.payload')

  // Paste sample -> infer output fields. Two PasteSampleControls exist
  // in this operation (Request body's and Output fields' own,
  // ManualSchemaEditor.tsx) -- Output fields' renders last in DOM
  // order, and clicking its toggle is the only one open, so the
  // resulting text/infer controls are unambiguous without needing
  // `.last()` beyond the toggle itself.
  await operation.getByTestId('paste-sample-toggle').last().click()
  await operation.getByTestId('paste-sample-text').fill(JSON.stringify({ name: 'Ada', age: 36 }))
  await operation.getByTestId('paste-sample-infer').click()

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

  // Set Default/Description/Enum on the inferred "name" field.
  await nameRow.getByLabel('Default value').fill('Ada')
  await nameRow.getByLabel('Description').fill('widget owner name')
  await nameRow.getByLabel('Enum values').fill('Ada, Bob')

  await page.getByRole('button', { name: 'Save connector' }).click()

  const row = connectorRow(page, 'Schema Maturity Connector')
  await expect(row).toBeVisible()
  await row.getByText('Schema Maturity Connector', { exact: true }).click()
  await expect(page.getByTestId('connector-summary')).toBeVisible()

  const attrPanel = page.getByRole('tabpanel', { name: 'Available attributes' })
  await page.getByRole('tab', { name: 'Available attributes' }).click()
  await attrPanel.getByLabel('Operation').selectOption({ label: 'GET /widgets' })

  await expect(attrPanel.getByText('name', { exact: true })).toBeVisible()
  await expect(attrPanel.getByText('default: Ada')).toBeVisible()
  await expect(attrPanel.getByText('enum: Ada, Bob')).toBeVisible()
  await expect(attrPanel.getByText('name: widget owner name')).toBeVisible()
  await expect(attrPanel.getByText('age', { exact: true })).toBeVisible()

  // The response extract expression round-trips through Edit.
  await page.getByTestId('summary-edit').click()
  await page.getByRole('button', { name: 'Manual editor' }).click()
  await expect(page.getByLabel('Response extract expression')).toHaveValue('envelope.payload')
  await page.getByRole('button', { name: 'Cancel' }).click()

  await deleteConnector(page, 'Schema Maturity Connector')
})
