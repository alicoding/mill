import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'

// Exercises docs/adr/0013's request draft testing over real Go
// bindings (Wails3 server mode), not mocks. Deliberately doesn't assert
// on a real HTTP response body -- pointing a real network call at an
// external host would be flaky/environment-dependent (this repo's own
// e2e discipline, docs/SPEC.md §1.3, only asserts what's
// environment-independent). A connection refused against a reserved,
// almost-certainly-unbound local port is a real transport failure, not
// a mock -- deterministic across any environment this suite runs in,
// same "real backend, deterministic outcome" bar the other request
// e2e specs already hold to.
//
// Each test deletes the request(s) it creates -- same shared-settings
// cleanup discipline as configure-requests.spec.ts.

function requestRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="request"]').filter({ has: page.getByText(label, { exact: true }) })
}

// docs/adr/0014: the list is its own pinned tab now -- switch back to
// it first, since a still-open view/edit tab leaves the list panel
// `hidden` (Primer's TabPanel never unmounts, just toggles `hidden`),
// and a hidden element isn't clickable.
async function deleteRequest(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('link', { name: 'Configure' }).click()
  await clickRowAction(page, requestRow(page, label), 'Delete')
  await expect(requestRow(page, label)).toHaveCount(0)
}

test('Running a test against an unreachable address logs a deterministic error', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('Test Panel Request')
  // Port 1 is reserved and essentially never bound -- a connection
  // refused, not a DNS lookup or a real remote host.
  await page.getByLabel('URL', { exact: true }).fill('http://127.0.0.1:1/widgets')

  // The manual editor is always visible, pre-seeded with the request's
  // one implicit operation (1:1 model) -- Method is the request's own
  // field (defaults GET), not part of schema authoring.
  const editor = page.getByTestId('manual-schema-editor')
  const operation = editor.getByTestId('manual-operation')
  // One-URL model: no path input -- the endpoint lives in the URL above.
  await operation.getByRole('button', { name: 'Add parameter' }).click()
  const paramRow = operation.getByTestId('manual-field-row').last()
  await paramRow.getByLabel('Field name').fill('q')

  // A single declared operation auto-selects, no dropdown to drive
  // (docs/SPEC.md §3.5's "no UI for a decision that doesn't exist").
  const testPanel = page.getByTestId('request-test-panel')
  await expect(testPanel).toBeVisible()
  await expect(testPanel.getByTestId('test-operation-single')).toHaveText('GET /')

  await testPanel.getByTestId('generate-sample-payload').click()
  const fieldValue = testPanel.getByTestId('test-field-value')
  await expect(fieldValue).not.toHaveValue('')

  await testPanel.getByTestId('run-request-test').click()
  const logEntry = testPanel.getByTestId('request-test-log-entry').first()
  await expect(logEntry).toBeVisible({ timeout: 30_000 })
  await expect(logEntry.getByText('error', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Save request' }).click()
  await expect(requestRow(page, 'Test Panel Request')).toBeVisible()
  await deleteRequest(page, 'Test Panel Request')
})

test('Duplicating a request pre-fills a new form without carrying over the secret', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('Original Request')
  await page.getByLabel('URL', { exact: true }).fill('https://api.example.com')
  await page.getByLabel('Auth type').selectOption('bearer')
  await page.getByLabel('Secret', { exact: true }).fill('shh-original-secret')
  await page.getByRole('button', { name: 'Save request' }).click()
  await expect(requestRow(page, 'Original Request')).toBeVisible()

  // docs/adr/0014: Duplicate lives on the read-only summary view now,
  // not directly on the list row.
  await requestRow(page, 'Original Request').getByText('Original Request', { exact: true }).click()
  await expect(page.getByTestId('request-summary')).toBeVisible()
  await page.getByRole('button', { name: 'Duplicate' }).click()

  await expect(page.getByLabel('Label')).toHaveValue('Original Request copy')
  await expect(page.getByLabel('URL', { exact: true })).toHaveValue('https://api.example.com')
  await expect(page.getByLabel('Auth type')).toHaveValue('bearer')
  // Secret must come across empty -- it was never readable back through
  // Mill in the first place (write-only design, docs/SPEC.md §3.5).
  await expect(page.getByLabel('Secret', { exact: true })).toHaveValue('')
  await page.getByLabel('Secret', { exact: true }).fill('shh-copy-secret')

  await page.getByRole('button', { name: 'Save request' }).click()
  await expect(requestRow(page, 'Original Request copy')).toBeVisible()

  await deleteRequest(page, 'Original Request')
  await deleteRequest(page, 'Original Request copy')
})
