import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import { createSecret, deleteSecret } from './fixtures/secretStore'

// Exercises ADR-0015 Phase 3 (JOSE/JWE) through the real UI/backend --
// the actual encryption round trip is already proven by the Go tests
// (internal/domain/composition/jose_test.go, real RSA keypairs against
// go-jose/v4 directly); this proves the Configure form's toggle and its
// two key PICKERS persist correctly through Create -> persist ->
// restore -> Edit. Since goal 0306 a key is named, not typed: both
// fields pick an entry from the secret store, and reopening Edit shows
// the same entry still named rather than a blank box. Cleans up what it
// creates, per .claude/rules/testing.md.

function requestRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="request"]').filter({ has: page.getByText(label, { exact: true }) })
}

async function deleteRequest(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('link', { name: 'Configure' }).click()
  await clickRowAction(page, requestRow(page, label), 'Delete')
  await expect(requestRow(page, label)).toHaveCount(0)
}

const fakePublicKeyPEM = '-----BEGIN PUBLIC KEY-----\nfake-test-key-not-real-crypto\n-----END PUBLIC KEY-----'
const fakePrivateKeyPEM = '-----BEGIN PRIVATE KEY-----\nfake-test-key-not-real-crypto\n-----END PRIVATE KEY-----'

test('JOSE encryption toggle, recipient public key, and decrypt-response persist through Save and reload into Edit', async ({ page }) => {
  await page.goto('/')
  // A key is named, not typed (goal 0306): both entries exist in the
  // store before the form can point at them, and both are kind "key",
  // so the pickers offer them at all.
  const publicRef = await createSecret(page, 'ZzE2eJosePublicKey', fakePublicKeyPEM, 'key')
  const privateRef = await createSecret(page, 'ZzE2eJosePrivateKey', fakePrivateKeyPEM, 'key')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('JOSE Request')
  await page.getByLabel('URL', { exact: true }).fill('https://api.example.com')

  // The JOSE section's config fields are hidden until Enable is checked.
  // JOSE lives behind the form's Advanced disclosure (goal 0315), closed
  // for a new integration.
  await expect(page.getByTestId('jose-enabled-checkbox')).toBeHidden()
  await page.getByTestId('request-advanced-summary').click()
  await expect(page.getByTestId('jose-recipient-public-key')).toHaveCount(0)
  await page.getByTestId('jose-enabled-checkbox').click()
  await expect(page.getByTestId('jose-recipient-public-key')).toBeVisible()

  await page.getByTestId('jose-recipient-public-key').selectOption({ label: 'ZzE2eJosePublicKey' })

  // The private-key field is further gated behind "Decrypt response".
  await expect(page.getByTestId('jose-private-key')).toHaveCount(0)
  await page.getByTestId('jose-decrypt-response-checkbox').click()
  await expect(page.getByTestId('jose-private-key')).toBeVisible()
  await page.getByTestId('jose-private-key').selectOption({ label: 'ZzE2eJosePrivateKey' })

  await page.getByRole('button', { name: 'Save integration' }).click()

  const row = requestRow(page, 'JOSE Request')
  await expect(row).toBeVisible()

  await requestRow(page, 'JOSE Request').getByText('JOSE Request', { exact: true }).click()
  await expect(page.getByTestId('request-summary')).toBeVisible()
  await expect(page.getByText('Enabled (decrypts responses)')).toBeVisible()

  // Reopening Edit shows both keys still NAMED -- the reference is the
  // request's own field, so an edit cannot silently unname a key the
  // way a blanked write-only box could.
  await page.getByTestId('summary-edit').click()
  await page.getByTestId('request-advanced-summary').click()
  await expect(page.getByTestId('jose-recipient-public-key')).toHaveValue(publicRef.replace('vault:', ''))
  await expect(page.getByTestId('jose-private-key')).toHaveValue(privateRef.replace('vault:', ''))
  // The value itself is nowhere on the page: a picker shows titles.
  await expect(page.locator('body')).not.toContainText('fake-test-key-not-real-crypto')

  await page.getByRole('button', { name: 'Cancel' }).click()
  await deleteRequest(page, 'JOSE Request')
  await deleteSecret(page, publicRef)
  await deleteSecret(page, privateRef)
})

test('JOSE encryption is disabled by default, and toggling it off after enabling hides its fields again', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('Plain Request')
  await page.getByLabel('URL', { exact: true }).fill('https://api.example.com')

  await page.getByTestId('request-advanced-summary').click()
  await expect(page.getByTestId('jose-recipient-public-key')).toHaveCount(0)
  await page.getByTestId('jose-enabled-checkbox').click()
  await expect(page.getByTestId('jose-recipient-public-key')).toBeVisible()
  await page.getByTestId('jose-enabled-checkbox').click()
  await expect(page.getByTestId('jose-recipient-public-key')).toHaveCount(0)

  await page.getByRole('button', { name: 'Save integration' }).click()
  await expect(requestRow(page, 'Plain Request')).toBeVisible()

  await requestRow(page, 'Plain Request').getByText('Plain Request', { exact: true }).click()
  await expect(page.getByTestId('request-summary').getByText('Disabled')).toBeVisible()

  await deleteRequest(page, 'Plain Request')
})
