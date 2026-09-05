// Importing from a password export (goal 0306 S4): Mill reads the file
// the reader exported -- never another application's own credential
// database -- and deletes it afterwards, because an export holds every
// password in plain text. Shared pool: the entries this spec creates
// are deleted here.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures/server'
import { openSecrets, ensureVault, deleteSecret } from './fixtures/secretStore'
import { callBindingViaRPC } from './fixtures/wailsRpc'

const SECRETS = 'github.com/alicoding/mill/internal/services/secretsvc.SecretService.'
const EXPORT = fs.readFileSync(
	path.join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'password-export-sample.csv'),
	'utf8',
)

test('a password export imports as entries and the file is deleted', async ({ page }) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-import-'))
	const csv = path.join(dir, 'passwords.csv')
	fs.writeFileSync(csv, EXPORT)
	try {
		await page.goto('/')
		await ensureVault(page)
		await openSecrets(page)
		await page.getByTestId('secrets-import').click()
		await page.getByTestId('secret-import-path').fill(csv)
		await page.getByTestId('secret-import-path').blur()
		await expect(page.getByTestId('secret-import-preview')).toHaveText('2 entries found in passwords.csv.')
		await expect(page.getByTestId('secret-import-delete')).toBeChecked()
		await page.getByRole('button', { name: 'Import', exact: true }).last().click()

		await expect(page.locator('[data-testid="inventory-row"][data-entity="secret"]').filter({ hasText: 'ZzE2eImportedOne' })).toBeVisible()
		expect(fs.existsSync(csv)).toBe(false)

		const list = await callBindingViaRPC<{ ID: string; Title: string; Tags: string[] }[]>(page, SECRETS + 'ListSecrets', [])
		const mine = list.filter((e) => e.Title.startsWith('ZzE2eImported'))
		expect(mine.length).toBe(2)
		expect(mine[0].Tags).toEqual(['imported'])
		for (const e of mine) await deleteSecret(page, `vault:${e.ID}`)
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('a file that is not a password export says so and imports nothing', async ({ page }) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-import-bad-'))
	const csv = path.join(dir, 'notes.csv')
	fs.writeFileSync(csv, 'a,b,c\n1,2,3\n')
	try {
		await page.goto('/')
		await ensureVault(page)
		await openSecrets(page)
		await page.getByTestId('secrets-import').click()
		await page.getByTestId('secret-import-path').fill(csv)
		await page.getByTestId('secret-import-path').blur()
		await expect(page.getByTestId('secret-import-error')).toHaveText("Can't read this file as a password export.")
		expect(fs.existsSync(csv)).toBe(true)
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})
