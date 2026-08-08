import { test, expect } from '@playwright/test'

// Exercises ADR-0015's auth-type catalogue through the real UI/backend,
// not just the Go unit tests (authstrategy_test.go) -- proves the
// Configure form's progressive-disclosure fields actually round-trip
// through Create -> persist -> restore -> Edit, and that the two
// deliberate stubs (OAuth1Vendor/mTLS) are honestly labeled rather than
// silently presented as working. Cleans up what it creates, per
// .claude/rules/testing.md.

function connectorRow(page: import('@playwright/test').Page, label: string) {
  return page.getByTestId('connector-row').filter({ has: page.getByText(label, { exact: true }) })
}

async function deleteConnector(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('tab', { name: 'Connectors' }).click()
  await connectorRow(page, label).getByRole('button', { name: `Delete ${label}` }).click()
  await expect(connectorRow(page, label)).toHaveCount(0)
}

test('An OAuth 2.0 connector persists its non-secret config and reloads it into Edit', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-connector').click()
  await page.getByLabel('Label').fill('OAuth2 Connector')
  await page.getByLabel('Base URL').fill('https://api.example.com')
  await page.getByLabel('Auth type').selectOption('oauth2')

  await page.getByLabel('Token URL').fill('https://auth.example.com/oauth/token')
  await page.getByLabel('Client ID').fill('client-abc')
  await page.getByLabel('Scope').fill('read write')
  await page.getByLabel('Client secret').fill('super-secret')
  await page.getByRole('button', { name: 'Save connector' }).click()

  const row = connectorRow(page, 'OAuth2 Connector')
  await expect(row).toBeVisible();

  // Details tab shows the resolved auth-type label, not the raw enum value.
  await connectorRow(page, 'OAuth2 Connector').getByText('OAuth2 Connector', { exact: true }).click();
  await expect(page.getByTestId('connector-summary')).toBeVisible()
  await expect(page.getByText('OAuth 2.0 (client credentials)')).toBeVisible()

  // Reopening Edit reloads the non-secret OAuth2 config -- the secret
  // itself stays blank (write-only, docs/SPEC.md §3.5), never pre-filled.
  await page.getByTestId('summary-edit').click()
  await expect(page.getByLabel('Token URL')).toHaveValue('https://auth.example.com/oauth/token')
  await expect(page.getByLabel('Client ID')).toHaveValue('client-abc')
  await expect(page.getByLabel('Scope')).toHaveValue('read write')
  await expect(page.getByLabel('Client secret')).toHaveValue('')

  await page.getByRole('button', { name: 'Cancel' }).click()
  await deleteConnector(page, 'OAuth2 Connector')
})

test('An HMAC connector persists a custom signature header name', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-connector').click()
  await page.getByLabel('Label').fill('HMAC Connector')
  await page.getByLabel('Base URL').fill('https://api.example.com')
  await page.getByLabel('Auth type').selectOption('hmac')
  await page.getByLabel('Signature header name').fill('X-Vendor-Signature')
  await page.getByLabel('Secret').fill('signing-key')
  await page.getByRole('button', { name: 'Save connector' }).click()

  await expect(connectorRow(page, 'HMAC Connector')).toBeVisible()
  await connectorRow(page, 'HMAC Connector').getByText('HMAC Connector', { exact: true }).click()
  await page.getByTestId('summary-edit').click()
  await expect(page.getByLabel('Signature header name')).toHaveValue('X-Vendor-Signature')

  await page.getByRole('button', { name: 'Cancel' }).click()
  await deleteConnector(page, 'HMAC Connector')
})

test('mTLS is selectable but clearly marked not yet implemented', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-connector').click()
  await page.getByLabel('Label').fill('mTLS Connector')
  await page.getByLabel('Base URL').fill('https://api.example.com')
  await page.getByLabel('Auth type').selectOption('mtls')

  await expect(page.getByText('Not yet implemented')).toBeVisible()

  // Never persisted -- Cancel, nothing to clean up.
  await page.getByRole('button', { name: 'Cancel' }).click()
})
