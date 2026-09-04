import { expect, test } from '@playwright/test'
import { launchWithPlugins, runFromPalette } from './fixtures/runtimePlugins'

// Per-plugin reload (goal 0319): one plugin re-activates in place --
// its contributions come back from a freshly imported module -- with
// no app reload. Dedicated server per test, the same reason every
// runtime-plugin spec has one (MILL_PLUGINS_DIR is process-wide);
// offsets 70 and 74 (see launchWithPlugins on picking one).

// The marker is how "no app reload happened" is asserted: a value set
// on window before the click survives a re-render and a route change,
// but never survives a page load.
const MARKER = 'window.__millReloadMarker'

async function markPage(page: import('@playwright/test').Page) {
	await page.evaluate(() => { (window as unknown as Record<string, string>).__millReloadMarker = 'alive' })
}

test('reloading one plugin from its Extensions row re-registers what it contributes, with no app reload', async () => {
	const { page, close } = await launchWithPlugins(70, { withNotifier: true })
	try {
		await page.goto('/')
		await page.getByRole('link', { name: 'Settings' }).click()
		const row = page.locator('[data-testid="extensions-plugin-row"][data-plugin-id="notify-probe"]')
		await row.scrollIntoViewIfNeeded()
		await expect(row).toBeVisible()
		await markPage(page)

		await row.getByTestId('extensions-plugin-reload').click()

		await expect(page.locator('[data-testid^="notice-pushed-"]', { hasText: 'Reloaded Notify probe' })).toBeVisible()
		expect(await page.evaluate(MARKER)).toBe('alive')

		// The command the fresh module registered runs, from the palette,
		// with no app reload in between.
		await runFromPalette(page, 'Say hello from the probe')
		await expect(page.locator('[data-testid^="notice-pushed-"]', { hasText: 'Hello from the probe.' })).toBeVisible()
		expect(await page.evaluate(MARKER)).toBe('alive')

		// A canvas object's registration survives the same sweep: the
		// bookmark plugin's tool is back in the tray after ITS reload.
		const bookmarkRow = page.locator('[data-testid="extensions-plugin-row"][data-plugin-id="mill-bookmark"]')
		await bookmarkRow.scrollIntoViewIfNeeded()
		await bookmarkRow.getByTestId('extensions-plugin-reload').click()
		await expect(page.locator('[data-testid^="notice-pushed-"]', { hasText: 'Reloaded Bookmark' })).toBeVisible()
		await page.getByRole('link', { name: 'Atlas' }).click()
		await expect(page.getByTestId('atlas-board')).toBeVisible()
		await expect(page.locator('[data-testid="atlas-creation-tray"] button[aria-label="Bookmark"]')).toBeVisible()
		expect(await page.evaluate(MARKER)).toBe('alive')
	} finally {
		await close()
	}
})

test('the same reload is one registry command, reachable from the palette', async () => {
	const { page, close } = await launchWithPlugins(74)
	try {
		await page.goto('/')
		await page.getByRole('link', { name: 'Atlas' }).click()
		await expect(page.getByTestId('atlas-board')).toBeVisible()
		await markPage(page)

		await runFromPalette(page, 'Reload Bookmark')

		await expect(page.locator('[data-testid^="notice-pushed-"]', { hasText: 'Reloaded Bookmark' })).toBeVisible()
		expect(await page.evaluate(MARKER)).toBe('alive')
		await expect(page.locator('[data-testid="atlas-creation-tray"] button[aria-label="Bookmark"]')).toBeVisible()
	} finally {
		await close()
	}
})
