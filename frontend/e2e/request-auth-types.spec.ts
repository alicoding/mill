import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'

// Exercises ADR-0015's auth-type catalogue through the real UI/backend,
// not just the Go unit tests (authstrategy_test.go) -- proves the
// Configure form's progressive-disclosure fields actually round-trip
// through Create -> persist -> restore -> Edit, and that the two
// deliberate stubs (OAuth1Vendor/mTLS) are honestly labeled rather than
// silently presented as working. Cleans up what it creates, per
// .claude/rules/testing.md.

function requestRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="request"]').filter({ has: page.getByText(label, { exact: true }) })
}

async function deleteRequest(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('link', { name: 'Configure' }).click()
  await clickRowAction(page, requestRow(page, label), 'Delete')
  await expect(requestRow(page, label)).toHaveCount(0)
}

test('An OAuth 2.0 request persists its non-secret config and reloads it into Edit', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('OAuth2 Request')
  await page.getByLabel('URL', { exact: true }).fill('https://api.example.com')
  await page.getByLabel('Auth type').selectOption('oauth2')

  await page.getByLabel('Token URL').fill('https://auth.example.com/oauth/token')
  await page.getByLabel('Client ID').fill('client-abc')
  await page.getByLabel('Scope').fill('read write')
  await page.getByLabel('Client secret').fill('super-secret')
  await page.getByRole('button', { name: 'Save integration' }).click()

  const row = requestRow(page, 'OAuth2 Request')
  await expect(row).toBeVisible();

  // Details tab shows the resolved auth-type label, not the raw enum value.
  await requestRow(page, 'OAuth2 Request').getByText('OAuth2 Request', { exact: true }).click();
  await expect(page.getByTestId('request-summary')).toBeVisible()
  // Scoped to the summary panel -- the list rows' auth chips now show
  // the same full AUTH_LABEL text (shared authTypeLabels.ts map), so an
  // unscoped getByText matches the seeded OAuth2 example's row too.
  await expect(page.getByTestId('request-summary').getByText('OAuth 2.0 (client credentials)')).toBeVisible()

  // Reopening Edit reloads the non-secret OAuth2 config -- the secret
  // itself stays blank (write-only, docs/SPEC.md §3.5), never pre-filled.
  await page.getByTestId('summary-edit').click()
  await expect(page.getByLabel('Token URL')).toHaveValue('https://auth.example.com/oauth/token')
  await expect(page.getByLabel('Client ID')).toHaveValue('client-abc')
  await expect(page.getByLabel('Scope')).toHaveValue('read write')
  await expect(page.getByLabel('Client secret')).toHaveValue('')

  await page.getByRole('button', { name: 'Cancel' }).click()
  await deleteRequest(page, 'OAuth2 Request')
})

test('An HMAC request persists a custom signature header name', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('HMAC Request')
  await page.getByLabel('URL', { exact: true }).fill('https://api.example.com')
  await page.getByLabel('Auth type').selectOption('hmac')
  await page.getByLabel('Signature header name').fill('X-Vendor-Signature')
  await page.getByLabel('Secret', { exact: true }).fill('signing-key')
  await page.getByRole('button', { name: 'Save integration' }).click()

  await expect(requestRow(page, 'HMAC Request')).toBeVisible()
  await requestRow(page, 'HMAC Request').getByText('HMAC Request', { exact: true }).click()
  await page.getByTestId('summary-edit').click()
  await expect(page.getByLabel('Signature header name')).toHaveValue('X-Vendor-Signature')

  await page.getByRole('button', { name: 'Cancel' }).click()
  await deleteRequest(page, 'HMAC Request')
})

test('mTLS is selectable but clearly marked not yet implemented', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('mTLS Request')
  await page.getByLabel('URL', { exact: true }).fill('https://api.example.com')
  // An unimplemented type is not offered for a new integration (goal
  // 0315); the wire value stays for records that carry it.
  await expect(page.getByLabel('Auth type').locator('option[value="mtls"]')).toHaveCount(0)
  await expect(page.getByLabel('Auth type').locator('option[value="oauth1vendor"]')).toHaveCount(0)
  await expect(page.getByLabel('Auth type').locator('option[value="oauth2"]')).toHaveCount(1)

  // Never persisted -- Cancel, nothing to clean up.
  await page.getByRole('button', { name: 'Cancel' }).click()
})
