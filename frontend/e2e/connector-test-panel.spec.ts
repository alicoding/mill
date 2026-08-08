import { test, expect } from '@playwright/test'

// Exercises docs/adr/0013's connector draft testing over real Go
// bindings (Wails3 server mode), not mocks. Deliberately doesn't assert
// on a real HTTP response body -- pointing a real network call at an
// external host would be flaky/environment-dependent (this repo's own
// e2e discipline, docs/SPEC.md §1.3, only asserts what's
// environment-independent). A connection refused against a reserved,
// almost-certainly-unbound local port is a real transport failure, not
// a mock -- deterministic across any environment this suite runs in,
// same "real backend, deterministic outcome" bar the other connector
// e2e specs already hold to.
//
// Each test deletes the connector(s) it creates -- same shared-settings
// cleanup discipline as configure-integration.spec.ts.

function connectorRow(page: import('@playwright/test').Page, label: string) {
  return page.getByTestId('connector-row').filter({ has: page.getByText(label, { exact: true }) })
}

async function deleteConnector(page: import('@playwright/test').Page, label: string) {
  await connectorRow(page, label).getByRole('button', { name: `Delete ${label}` }).click()
  await expect(connectorRow(page, label)).toHaveCount(0)
}

test('Running a test against an unreachable address logs a deterministic error', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-connector').click()
  await page.getByLabel('Label').fill('Test Panel Connector')
  // Port 1 is reserved and essentially never bound -- a connection
  // refused, not a DNS lookup or a real remote host.
  await page.getByLabel('Base URL').fill('http://127.0.0.1:1')

  await page.getByRole('tab', { name: 'Schema' }).click()
  await page.getByRole('button', { name: 'Manual editor' }).click()
  const editor = page.getByTestId('manual-schema-editor')
  await editor.getByTestId('add-operation').click()
  const operation = editor.getByTestId('manual-operation')
  await operation.getByLabel('Method').selectOption('GET')
  await operation.getByLabel('Path').fill('/widgets')
  await operation.getByRole('button', { name: 'Add parameter' }).click()
  const paramRow = operation.getByTestId('manual-field-row').last()
  await paramRow.getByLabel('Field name').fill('q')

  await page.getByRole('tab', { name: 'Test' }).click()
  const testPanel = page.getByTestId('connector-test-panel')
  await expect(testPanel).toBeVisible()
  await testPanel.getByTestId('test-operation-select').selectOption('GET /widgets')

  await testPanel.getByTestId('generate-sample-payload').click()
  const fieldValue = testPanel.getByTestId('test-field-value')
  await expect(fieldValue).not.toHaveValue('')

  await testPanel.getByTestId('run-connector-test').click()
  const logEntry = testPanel.getByTestId('connector-test-log-entry').first()
  await expect(logEntry).toBeVisible({ timeout: 30_000 })
  await expect(logEntry.getByText('error', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Save connector' }).click()
  await expect(connectorRow(page, 'Test Panel Connector')).toBeVisible()
  await deleteConnector(page, 'Test Panel Connector')
})

test('Duplicating a connector pre-fills a new form without carrying over the secret', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-connector').click()
  await page.getByLabel('Label').fill('Original Connector')
  await page.getByLabel('Base URL').fill('https://api.example.com')
  await page.getByRole('tab', { name: 'Auth' }).click()
  await page.getByLabel('Auth type').selectOption('bearer')
  await page.getByLabel('Secret').fill('shh-original-secret')
  await page.getByRole('button', { name: 'Save connector' }).click()
  await expect(connectorRow(page, 'Original Connector')).toBeVisible()

  await connectorRow(page, 'Original Connector').getByRole('button', { name: 'Duplicate Original Connector' }).click()
  await expect(page.getByLabel('Label')).toHaveValue('Original Connector copy')
  await expect(page.getByLabel('Base URL')).toHaveValue('https://api.example.com')
  await page.getByRole('tab', { name: 'Auth' }).click()
  await expect(page.getByLabel('Auth type')).toHaveValue('bearer')
  // Secret must come across empty -- it was never readable back through
  // Mill in the first place (write-only design, docs/SPEC.md §3.5).
  await expect(page.getByLabel('Secret')).toHaveValue('')
  await page.getByLabel('Secret').fill('shh-copy-secret')

  await page.getByRole('button', { name: 'Save connector' }).click()
  await expect(connectorRow(page, 'Original Connector copy')).toBeVisible()

  await deleteConnector(page, 'Original Connector')
  await deleteConnector(page, 'Original Connector copy')
})
