// Every secret an integration uses is a reference it NAMES (goal
// 0306): the form picks an entry from the secret store, adding one
// without leaving the form, and what the request stores is the
// reference -- never the token. Shared pool: everything here is
// created and deleted by this file.
import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import { createSecret, deleteSecret, ensureVault, openSecrets, secretTitles } from './fixtures/secretStore'
import { callBindingViaRPC } from './fixtures/wailsRpc'

const CONFIGURE = 'github.com/alicoding/mill/internal/services/configuresvc.ConfigureService.'

function requestRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="request"]').filter({ has: page.getByText(label, { exact: true }) })
}

test('an integration names a bearer token added from its own form, and stores the reference rather than the token', async ({ page }) => {
  await page.goto('/')
  await ensureVault(page)
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('ZzE2eBearerIntegration')
  await page.getByLabel('URL', { exact: true }).fill('https://api.example.com')
  await page.getByLabel('Auth type').selectOption('bearer')

  // Add a secret without leaving the form: the entry is created in the
  // store, and the field ends up naming it.
  await expect(page.getByTestId('request-secret-picker')).toHaveValue('')
  await page.getByTestId('secret-ref-add').click()
  await expect(page.getByTestId('secret-title-input')).toHaveValue('ZzE2eBearerIntegration: secret')
  await page.getByTestId('secret-title-input').fill('ZzE2eBearerToken')
  await page.getByTestId('secret-password-input').fill('tok-e2e-never-stored-on-the-request')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('request-secret-picker')).not.toHaveValue('')

  await page.getByRole('button', { name: 'Save integration' }).click()
  await expect(requestRow(page, 'ZzE2eBearerIntegration')).toBeVisible()

  // What the request actually holds: a reference, and no token anywhere.
  const requests = await callBindingViaRPC<{ ID: string; Label: string; SecretRef: string }[]>(page, CONFIGURE + 'HTTPRequests', [])
  const mine = requests.find((r) => r.Label === 'ZzE2eBearerIntegration')
  expect(mine?.SecretRef).toMatch(/^vault:/)
  expect(JSON.stringify(requests)).not.toContain('tok-e2e-never-stored-on-the-request')

  // The entry it names is a real one in the store.
  const entries = await secretTitles(page)
  expect(entries.some((e) => e.ID === mine?.SecretRef.replace('vault:', '') && e.Title === 'ZzE2eBearerToken')).toBe(true)

  await clickRowAction(page, requestRow(page, 'ZzE2eBearerIntegration'), 'Delete')
  await expect(requestRow(page, 'ZzE2eBearerIntegration')).toHaveCount(0)
  // Deleting the integration leaves the entry alone -- the same
  // credential may be named elsewhere.
  const after = await secretTitles(page)
  expect(after.some((e) => e.Title === 'ZzE2eBearerToken')).toBe(true)
  await deleteSecret(page, mine!.SecretRef)
})

test('a picker offers only the entry kinds its field can use', async ({ page }) => {
  await page.goto('/')
  const keyRef = await createSecret(page, 'ZzE2eKindKey', '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----', 'key')
  const textRef = await createSecret(page, 'ZzE2eKindText', 'a-token', 'text')
  try {
    await page.getByRole('link', { name: 'Configure' }).click()
    await page.getByTestId('new-integration').click()
    await page.getByTestId('new-integration-rest').click()
    await page.getByLabel('Label').fill('ZzE2eKindFilter')
    await page.getByLabel('URL', { exact: true }).fill('https://api.example.com')
    await page.getByLabel('Auth type').selectOption('bearer')

    // A bearer token is text: the key-kind entry is not on offer.
    const secretPicker = page.getByTestId('request-secret-picker')
    await expect(secretPicker.locator('option', { hasText: 'ZzE2eKindText' })).toHaveCount(1)
    await expect(secretPicker.locator('option', { hasText: 'ZzE2eKindKey' })).toHaveCount(0)

    // Mill's own JOSE private key is a key: there, the text entry is not.
    await page.getByTestId('request-advanced-summary').click()
    await page.getByTestId('jose-enabled-checkbox').click()
    await page.getByTestId('jose-decrypt-response-checkbox').click()
    const keyPicker = page.getByTestId('jose-private-key')
    await expect(keyPicker.locator('option', { hasText: 'ZzE2eKindKey' })).toHaveCount(1)
    await expect(keyPicker.locator('option', { hasText: 'ZzE2eKindText' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Cancel' }).click()
  } finally {
    await deleteSecret(page, keyRef)
    await deleteSecret(page, textRef)
  }
})

test('a source-backed entry names a key in a source and shows no value of its own', async ({ page }) => {
  await page.goto('/')
  await ensureVault(page)
  await openSecrets(page)
  await page.getByTestId('secrets-new').click()
  await page.getByTestId('secret-title-input').fill('ZzE2eSourceBacked')
  await page.getByTestId('secret-storage-source').click()

  // With no source configured there is nothing to name: the form says
  // so rather than offering an empty list, and refuses to store an
  // entry that would resolve to nothing.
  await expect(page.getByTestId('secret-no-sources')).toBeVisible()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('secret-form-error')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
})
