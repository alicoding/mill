import { test, expect } from '@playwright/test'

// Exercises ADR-0011's sectioned Connector form + Manual schema editor
// end-to-end: authoring an operation's output field (with an alias and
// a nested extractPath) via the visual table, saving it, and confirming
// the real Go backend (synthesizeOpenAPISpec -> ConfigureService.
// CreateConnector -> openapispec.Parse -> ConnectorOperationFields)
// round-trips the alias/path correctly -- over real Go bindings (Wails3
// server mode), not mocks.

function connectorRow(page: import('@playwright/test').Page, label: string) {
  return page.getByTestId('connector-row').filter({ has: page.getByText(label, { exact: true }) })
}

async function deleteConnector(page: import('@playwright/test').Page, label: string) {
  await connectorRow(page, label).getByRole('button', { name: `Delete ${label}` }).click()
  await expect(connectorRow(page, label)).toHaveCount(0)
}

test('Authoring a schema via the Manual editor round-trips alias/path through the real backend', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-connector').click()
  await page.getByLabel('Label').fill('Manual Schema Connector')
  await page.getByLabel('Base URL').fill('https://api.example.com')

  await page.getByRole('tab', { name: 'Schema' }).click()
  await page.getByRole('button', { name: 'Manual editor' }).click()

  const editor = page.getByTestId('manual-schema-editor')
  await expect(editor).toBeVisible()
  await editor.getByTestId('add-operation').click()

  const operation = editor.getByTestId('manual-operation')
  await operation.getByLabel('Method').selectOption('GET')
  await operation.getByLabel('Path').fill('/widgets')

  await operation.getByRole('button', { name: 'Add output field' }).click()
  const outputRow = operation.getByTestId('manual-field-row').last()
  await outputRow.getByLabel('Field name').fill('n')
  await outputRow.getByLabel('Alias').fill('widgetName')
  await outputRow.getByLabel('Extract path').fill('data.name')

  await page.getByRole('button', { name: 'Save connector' }).click()

  const row = connectorRow(page, 'Manual Schema Connector')
  await expect(row).toBeVisible()

  await row.getByTestId('list-operations').click()
  const operations = row.getByTestId('connector-operations')
  await expect(operations.getByText('/widgets')).toBeVisible()
  await operations.getByTestId('show-operation-fields').click()

  const schema = row.getByTestId('operation-schema')
  await expect(schema).toBeVisible()
  await expect(schema.getByText('widgetName (n)')).toBeVisible()
  await expect(schema.getByText('path: data.name')).toBeVisible()

  await deleteConnector(page, 'Manual Schema Connector')
})
