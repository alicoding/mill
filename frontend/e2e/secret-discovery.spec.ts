// Finding .env files under a chosen folder (goal 0306 S4): the scan
// never wanders -- a dependency folder is skipped -- and what it finds
// becomes sources the reader picked. Shared pool: the temp tree and the
// sources this spec creates are its own, deleted here.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './fixtures/server'
import { openSecretSources } from './fixtures/secretStore'
import { clickRowAction } from './inventoryRow'

function tree(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-envscan-'))
	fs.mkdirSync(path.join(dir, 'zzapi'), { recursive: true })
	fs.writeFileSync(path.join(dir, 'zzapi', '.env'), 'API_TOKEN=tok-scan-1\nOTHER=x\n')
	fs.mkdirSync(path.join(dir, 'zzweb'), { recursive: true })
	fs.writeFileSync(path.join(dir, 'zzweb', '.env'), 'WEB_KEY=tok-scan-2\n')
	fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true })
	fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', '.env'), 'NEVER=1\n')
	return dir
}

test('a scan lists the .env files under a chosen folder, skips dependency folders, and adds the chosen ones as sources', async ({ page }) => {
	const dir = tree()
	try {
		await page.goto('/')
		await openSecretSources(page)
		await page.getByTestId('secretsource-scan-open').click()

		// Nothing is scanned without a folder.
		await expect(page.getByTestId('secret-scan-run')).toBeDisabled()
		await page.getByTestId('secret-scan-folder').fill(dir)
		await page.getByTestId('secret-scan-run').click()

		await expect(page.getByTestId('secret-scan-pick-zzapi/.env')).toBeVisible()
		await expect(page.getByTestId('secret-scan-pick-zzweb/.env')).toBeVisible()
		await expect(page.getByTestId('secret-scan-pick-node_modules/pkg/.env')).toHaveCount(0)

		// Only the one still ticked is added.
		await page.getByTestId('secret-scan-pick-zzweb/.env').uncheck()
		await page.getByRole('button', { name: 'Add as sources' }).click()

		const row = page.locator('[data-testid="inventory-row"][data-entity="secretsource"]').filter({ hasText: 'zzapi/.env' })
		await expect(row).toBeVisible()
		await expect(page.locator('[data-testid="inventory-row"][data-entity="secretsource"]').filter({ hasText: 'zzweb/.env' })).toHaveCount(0)
		await clickRowAction(page, row, 'Delete')
		await expect(row).toHaveCount(0)
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('a folder with no .env files says so', async ({ page }) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-envscan-empty-'))
	try {
		await page.goto('/')
		await openSecretSources(page)
		await page.getByTestId('secretsource-scan-open').click()
		await page.getByTestId('secret-scan-folder').fill(dir)
		await page.getByTestId('secret-scan-run').click()
		await expect(page.getByTestId('secret-scan-empty')).toHaveText('No .env files under this folder.')
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})
