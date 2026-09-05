// The entry is the record (goal 0306 S4): an entry carries its own
// custom fields and tags, the detail dialog reads them back, the list's
// search finds an entry by a tag or a field NAME, and a tag chip
// narrows the list to everything carrying it. Shared pool: every entry
// here is created and deleted by this spec.
import { test, expect } from './fixtures/server'
import { openSecrets, ensureVault, deleteSecret } from './fixtures/secretStore'
import { callBindingViaRPC } from './fixtures/wailsRpc'

const SECRETS = 'github.com/alicoding/mill/internal/services/secretsvc.SecretService.'

test('an entry carries its own fields and tags, and the list finds it by either', async ({ page }) => {
	await page.goto('/')
	await ensureVault(page)
	await openSecrets(page)

	await page.getByTestId('secrets-new').click()
	await page.getByTestId('secret-title-input').fill('ZzE2eRouter')
	await page.getByTestId('secret-password-input').fill('router-pw-fake')
	await page.getByTestId('secret-field-add').click()
	await page.getByTestId('secret-field-name-0').fill('Serial')
	await page.getByTestId('secret-field-value-0').fill('SN-E2E-1234')
	await page.getByTestId('secret-field-add').click()
	await page.getByTestId('secret-field-name-1').fill('Recovery code')
	await page.getByTestId('secret-field-value-1').fill('r3c0v3ry-fake')
	// The Hide toggle marks a value that stays hidden until asked for.
	await page.getByTestId('secret-field-hide-1').click()
	await expect(page.getByTestId('secret-field-value-1')).toHaveAttribute('type', 'password')
	await page.getByTestId('secret-tags-input').fill('zze2ehome')
	await page.keyboard.press('Enter')
	await page.getByRole('button', { name: 'Save', exact: true }).click()

	const row = page.locator('[data-testid="inventory-row"][data-entity="secret"]').filter({ hasText: 'ZzE2eRouter' })
	await expect(row).toBeVisible()
	await expect(row.getByTestId('secret-tag-zze2ehome')).toBeVisible()

	// The detail dialog reads the record back: the plain field visible,
	// the hidden one masked until Show, the tag as a chip, and where
	// the entry came from.
	await row.getByText('ZzE2eRouter', { exact: true }).click()
	await expect(page.getByTestId('secret-detail-field-Serial')).toHaveValue('SN-E2E-1234')
	await expect(page.getByTestId('secret-detail-field-Recovery code')).toHaveAttribute('type', 'password')
	await expect(page.getByTestId('secret-detail-tag-zze2ehome')).toBeVisible()
	await expect(page.getByTestId('secret-detail-source')).toHaveText('Added by hand')
	await page.getByRole('button', { name: 'Close' }).first().click()

	// The search matches a field NAME and a tag, never a value.
	const search = page.getByPlaceholder('Search secrets')
	await search.fill('Recovery code')
	await expect(row).toBeVisible()
	await search.fill('zze2ehome')
	await expect(row).toBeVisible()
	await search.fill('SN-E2E-1234')
	await expect(row).toHaveCount(0)
	await search.fill('')

	// A tag chip in a row narrows the list to that tag.
	await row.getByTestId('secret-tag-zze2ehome').click()
	await expect(search).toHaveValue('tag:zze2ehome')
	await expect(row).toBeVisible()
	await search.fill('')

	const list = await callBindingViaRPC<{ ID: string; Title: string }[]>(page, SECRETS + 'ListSecrets', [])
	const mine = list.find((e) => e.Title === 'ZzE2eRouter')
	if (!mine) throw new Error('the entry was not stored')
	await deleteSecret(page, `vault:${mine.ID}`)
})
