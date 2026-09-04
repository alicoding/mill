import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchWithPlugins, runFromPalette } from './fixtures/runtimePlugins'
import { RUNTIME_PLUGIN_RELOAD_SERVER_BASE_PORT, RUNTIME_PLUGIN_RELOAD_MCP_BASE_PORT } from './fixtures/serverPorts'
import { openExtensionDetail, openPluginDetail, pluginRow } from './fixtures/settingsNav'

const PORTS = { server: RUNTIME_PLUGIN_RELOAD_SERVER_BASE_PORT, mcp: RUNTIME_PLUGIN_RELOAD_MCP_BASE_PORT }
// The already-built server binary IS the one binary, so the scaffold
// runs here exactly as a user runs it -- and no second compile.
const MILL_BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.build', 'mill-server')

// Per-plugin reload (goal 0319): one plugin re-activates in place --
// its contributions come back from a freshly imported module -- with
// no app reload. Dedicated server per test, the same reason every
// runtime-plugin spec has one (MILL_PLUGINS_DIR is process-wide);
// dedicated port pair, offsets 0/2/4 within it.

// The marker is how "no app reload happened" is asserted: a value set
// on window before the click survives a re-render and a route change,
// but never survives a page load.
const MARKER = 'window.__millReloadMarker'

async function markPage(page: import('@playwright/test').Page) {
	await page.evaluate(() => { (window as unknown as Record<string, string>).__millReloadMarker = 'alive' })
}

test('reloading one plugin from its Extensions detail pane re-registers what it contributes, with no app reload', async () => {
	const { page, close } = await launchWithPlugins(0, { withNotifier: true, ports: PORTS })
	try {
		await page.goto('/')
		const detail = await openPluginDetail(page, 'notify-probe')
		await markPage(page)

		await detail.getByTestId('extensions-plugin-reload').click()

		await expect(page.locator('[data-testid^="notice-pushed-"]', { hasText: 'Reloaded Notify probe' })).toBeVisible()
		expect(await page.evaluate(MARKER)).toBe('alive')

		// The command the fresh module registered runs, from the palette,
		// with no app reload in between.
		await runFromPalette(page, 'Say hello from the probe')
		await expect(page.locator('[data-testid^="notice-pushed-"]', { hasText: 'Hello from the probe.' })).toBeVisible()
		expect(await page.evaluate(MARKER)).toBe('alive')

		// A canvas object's registration survives the same sweep: the
		// bookmark plugin's tool is back in the tray after ITS reload.
		const bookmarkDetail = await openExtensionDetail(page, pluginRow(page, 'mill-bookmark'), 'mill-bookmark')
		await bookmarkDetail.getByTestId('extensions-plugin-reload').click()
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
	const { page, close } = await launchWithPlugins(2, { ports: PORTS })
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

// The scaffold's other half (goal 0319 S2): `mill plugin new` is proven
// against pluginsvc.ConformDir in Go, and here against the loader
// itself -- what it writes activates and its command runs. The
// scaffold lands after boot, so the folder arrives the way any copied-
// in plugin does: awaiting review, then allowed, then loaded by ITS
// OWN row's reload rather than an app restart.
test('a folder written by `mill plugin new` loads, allowed then reloaded from its own detail pane', async () => {
	const { page, pluginsDir, close } = await launchWithPlugins(4, { ports: PORTS })
	try {
		await page.goto('/')
		execFileSync(MILL_BIN, ['plugin', 'new', 'Scaffold probe', '--dir', pluginsDir], { stdio: 'pipe' })
		await page.reload()
		const detail = await openPluginDetail(page, 'scaffold-probe')
		await expect(detail.getByTestId('extensions-plugin-review')).toBeVisible()

		await detail.getByTestId('extensions-plugin-allow').click()
		await detail.getByTestId('extensions-plugin-reload').click()
		await expect(page.locator('[data-testid^="notice-pushed-"]', { hasText: 'Reloaded Scaffold Probe' })).toBeVisible()

		// The command the scaffolded main.js registers runs.
		await runFromPalette(page, 'Scaffold Probe: say hello')
		await expect(page.locator('[data-testid^="notice-pushed-"]', { hasText: 'Hello from Scaffold Probe.' })).toBeVisible()
	} finally {
		await close()
	}
})
