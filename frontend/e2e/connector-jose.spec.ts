import { test, expect } from '@playwright/test'

// Exercises ADR-0015 Phase 3 (JOSE/JWE) through the real UI/backend --
// the actual encryption round trip is already proven by the Go tests
// (internal/domain/composition/jose_test.go, real RSA keypairs against
// go-jose/v4 directly); this proves the Configure form's toggle/fields
// persist correctly through Create -> persist -> restore -> Edit, and
// that the private key never comes back pre-filled (write-only,
// docs/SPEC.md §3.5). Cleans up what it creates, per
// .claude/rules/testing.md.

function connectorRow(page: import('@playwright/test').Page, label: string) {
  return page.getByTestId('connector-row').filter({ has: page.getByText(label, { exact: true }) })
}

async function deleteConnector(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('tab', { name: 'Connectors' }).click()
  await connectorRow(page, label).getByRole('button', { name: `Delete ${label}` }).click()
  await expect(connectorRow(page, label)).toHaveCount(0)
}

const fakePublicKeyPEM = '-----BEGIN PUBLIC KEY-----\nfake-test-key-not-real-crypto\n-----END PUBLIC KEY-----'
const fakePrivateKeyPEM = '-----BEGIN PRIVATE KEY-----\nfake-test-key-not-real-crypto\n-----END PRIVATE KEY-----'

test('JOSE encryption toggle, recipient public key, and decrypt-response persist through Save and reload into Edit', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-connector').click()
  await page.getByLabel('Label').fill('JOSE Connector')
  await page.getByLabel('Base URL').fill('https://api.example.com')

  // The JOSE section's config fields are hidden until Enable is checked.
  await expect(page.getByTestId('jose-recipient-public-key')).toHaveCount(0)
  await page.getByTestId('jose-enabled-checkbox').click()
  await expect(page.getByTestId('jose-recipient-public-key')).toBeVisible()

  await page.getByTestId('jose-recipient-public-key').fill(fakePublicKeyPEM)

  // The private-key field is further gated behind "Decrypt response".
  await expect(page.getByTestId('jose-private-key')).toHaveCount(0)
  await page.getByTestId('jose-decrypt-response-checkbox').click()
  await expect(page.getByTestId('jose-private-key')).toBeVisible()
  await page.getByTestId('jose-private-key').fill(fakePrivateKeyPEM)

  await page.getByRole('button', { name: 'Save connector' }).click()

  const row = connectorRow(page, 'JOSE Connector')
  await expect(row).toBeVisible()

  await connectorRow(page, 'JOSE Connector').getByText('JOSE Connector', { exact: true }).click()
  await expect(page.getByTestId('connector-summary')).toBeVisible()
  await expect(page.getByText('Enabled (decrypts responses)')).toBeVisible()

  // Reopening Edit reloads the non-secret config -- the private key
  // itself stays blank (write-only), never pre-filled.
  await page.getByTestId('summary-edit').click()
  await expect(page.getByTestId('jose-recipient-public-key')).toHaveValue(fakePublicKeyPEM)
  await expect(page.getByTestId('jose-private-key')).toHaveValue('')

  await page.getByRole('button', { name: 'Cancel' }).click()
  await deleteConnector(page, 'JOSE Connector')
})

test('JOSE encryption is disabled by default, and toggling it off after enabling hides its fields again', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-connector').click()
  await page.getByLabel('Label').fill('Plain Connector')
  await page.getByLabel('Base URL').fill('https://api.example.com')

  await expect(page.getByTestId('jose-recipient-public-key')).toHaveCount(0)
  await page.getByTestId('jose-enabled-checkbox').click()
  await expect(page.getByTestId('jose-recipient-public-key')).toBeVisible()
  await page.getByTestId('jose-enabled-checkbox').click()
  await expect(page.getByTestId('jose-recipient-public-key')).toHaveCount(0)

  await page.getByRole('button', { name: 'Save connector' }).click()
  await expect(connectorRow(page, 'Plain Connector')).toBeVisible()

  await connectorRow(page, 'Plain Connector').getByText('Plain Connector', { exact: true }).click()
  await expect(page.getByTestId('connector-summary').getByText('Disabled')).toBeVisible()

  await deleteConnector(page, 'Plain Connector')
})
