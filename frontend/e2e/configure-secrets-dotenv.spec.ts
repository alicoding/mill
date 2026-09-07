// A dotenv source shows its keys, and discovery stops being a typing
// chore (goal 0367): the source row's own read-back lists key NAMES
// (never a value), a rescan marks the file already being a source
// instead of duplicating it, a file Mill cannot parse is named with
// its reason, a second import updates rather than duplicates, and the
// palette opens the scan dialog from anywhere. Shared pool: the temp
// tree, the one source and the imported entries this spec creates are
// its own, deleted here; the seeded example source is only read.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './fixtures/server'
import { ensureVault, openSecretSources, secretTitles, deleteSecret } from './fixtures/secretStore'
import { gotoAppReady } from './fixtures/appReady'
import { clickRowAction, expandExamples } from './inventoryRow'
import { paletteDialog } from './fixtures/palette'

function tree(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-0367-'))
	fs.mkdirSync(path.join(dir, 'zzwidget'), { recursive: true })
	fs.writeFileSync(path.join(dir, 'zzwidget', '.env'), 'WIDGET_API_KEY=tok-readback\nWIDGET_PROJECT=proj-1\n')
	fs.mkdirSync(path.join(dir, 'zzbroken'), { recursive: true })
	fs.writeFileSync(path.join(dir, 'zzbroken', '.env.broken'), '"BAD LINE\n')
	return dir
}

function sourceRow(page: import('@playwright/test').Page, label: string) {
	return page.locator('[data-testid="inventory-row"][data-entity="secretsource"]').filter({ hasText: label })
}

test('a dotenv source lists its keys, the rescan marks what is already a source, and an unreadable file is named with its reason', async ({ page }) => {
	const dir = tree()
	try {
		await gotoAppReady(page)
		await ensureVault(page)
		await openSecretSources(page)

		// The scan, and the source it adds.
		await page.getByTestId('secretsource-scan-open').click()
		await page.getByTestId('secret-scan-folder').fill(dir)
		await page.getByTestId('secret-scan-run').click()
		await expect(page.getByTestId('secret-scan-pick-zzwidget/.env')).toBeVisible()
		// The unreadable sibling is named with its reason, never omitted.
		await expect(page.getByTestId('secret-scan-skip-zzbroken/.env.broken')).toContainText("Couldn't read this file:")
		await page.getByRole('button', { name: 'Add as sources' }).click()

		const row = sourceRow(page, 'zzwidget/.env')
		await expect(row).toBeVisible()
		// The collapsed row carries the count caption.
		await expect(row.getByTestId('inventory-row-description')).toContainText('2 keys')

		// Expand: the key NAMES are read back, one per line; the values
		// never are (tok-readback must not appear).
		await row.getByRole('button', { name: 'Show keys' }).click()
		await expect(row.getByTestId(/inventory-row-disclosure-content-/)).toContainText('WIDGET_API_KEY')
		await expect(row.getByTestId(/inventory-row-disclosure-content-/)).toContainText('WIDGET_PROJECT')
		await expect(row.getByTestId(/inventory-row-disclosure-content-/)).not.toContainText('tok-readback')

		// A rescan shows the file already being a source: checkbox
		// disabled, caption naming it, and it starts unticked.
		await page.getByTestId('secretsource-scan-open').click()
		await page.getByTestId('secret-scan-folder').fill(dir)
		await page.getByTestId('secret-scan-run').click()
		await expect(page.getByTestId('secret-scan-pick-zzwidget/.env')).toBeDisabled()
		await expect(page.getByTestId('secret-scan-pick-zzwidget/.env')).not.toBeChecked()
		await expect(page.getByTestId('secret-scan-already-zzwidget/.env')).toHaveText('Already a source')
		await page.keyboard.press('Escape')

		// Cleanup: the source this spec added.
		await clickRowAction(page, row, 'Delete')
		await expect(row).toHaveCount(0)
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('importing keys twice updates the same entries in place', async ({ page }) => {
	const dir = tree()
	try {
		await gotoAppReady(page)
		await ensureVault(page)
		await openSecretSources(page)

		const scanAndImport = async () => {
			await page.getByTestId('secretsource-scan-open').click()
			await page.getByTestId('secret-scan-folder').fill(dir)
			await page.getByTestId('secret-scan-run').click()
			await expect(page.getByTestId('secret-scan-pick-zzwidget/.env')).toBeVisible()
			await page.getByRole('button', { name: 'Import keys' }).click()
			// The dialog closes once the import completes.
			await expect(page.getByTestId('secret-scan-run')).toHaveCount(0)
		}
		await scanAndImport()
		await scanAndImport()

		const titles = (await secretTitles(page)).filter((t) => t.Title === 'WIDGET_API_KEY' || t.Title === 'WIDGET_PROJECT')
		const perKey = new Map<string, string[]>()
		for (const t of titles) perKey.set(t.Title, [...(perKey.get(t.Title) ?? []), t.ID])
		expect(perKey.get('WIDGET_API_KEY')).toHaveLength(1)
		expect(perKey.get('WIDGET_PROJECT')).toHaveLength(1)

		// Cleanup: the two entries this spec imported.
		for (const t of titles) await deleteSecret(page, t.ID)
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('the seeded example dotenv source materializes its own file and lists its keys', async ({ page }) => {
	await gotoAppReady(page)
	await openSecretSources(page)
	await expandExamples(page)
	const row = sourceRow(page, 'Example: Project .env')
	await expect(row).toBeVisible()
	await row.getByRole('button', { name: 'Show keys' }).click()
	await expect(row.getByTestId(/inventory-row-disclosure-content-/)).toContainText('EXAMPLE_API_TOKEN')
})

test('the palette command opens the scan dialog on the Sources section', async ({ page }) => {
	await gotoAppReady(page)
	await page.keyboard.press('Meta+k')
	await expect(paletteDialog(page)).toBeVisible()
	// The search field's own atomic insert (the CI keystroke-drop class).
	await paletteDialog(page).getByRole('combobox').fill('Find .env files')
	await paletteDialog(page).getByRole('option', { name: 'Find .env files…' }).click()
	// The palette navigated to the Sources section and opened the dialog.
	await expect(page.getByRole('dialog', { name: 'Find .env files' })).toBeVisible()
	await expect(page.getByTestId('secret-scan-folder')).toBeVisible()
})
