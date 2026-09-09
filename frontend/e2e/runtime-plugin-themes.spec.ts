// A plugin's contributed theme (goal 0342's contract), proven through
// the real install path a user takes -- write a folder into the
// plugins directory, allow it from its own Extensions row -- rather
// than a theme already present at boot (goal 0348 follow-up: the
// maturity ledger's own e2e cell for the themes family). Dedicated
// server: MILL_PLUGINS_DIR is process-wide and allowing a plugin
// writes the GLOBAL trust allow-list, the same two reasons every other
// runtime-plugin-*.spec.ts file takes one (runtime-plugins.spec.ts's
// own header comment). Offset 0 on its own disjoint port pair
// (serverPorts.ts).
import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchWithPlugins } from './fixtures/runtimePlugins'
import { openExtensions, openPluginDetail, openSettings } from './fixtures/settingsNav'
import { RUNTIME_PLUGIN_THEMES_MCP_BASE_PORT, RUNTIME_PLUGIN_THEMES_SERVER_BASE_PORT } from './fixtures/serverPorts'

const THEME_PLUGIN_ID = 'theme-probe'
const SCHEME_ID = `${THEME_PLUGIN_ID}.dusk`
const BG_TOKEN = '#221133'

test.describe.configure({ mode: 'serial' })

test('a plugin theme is offered only once its plugin is allowed, and picking it paints the page', async () => {
	const { page, pluginsDir, close } = await launchWithPlugins(0, {
		ports: { server: RUNTIME_PLUGIN_THEMES_SERVER_BASE_PORT, mcp: RUNTIME_PLUGIN_THEMES_MCP_BASE_PORT },
	})
	const pluginDir = path.join(pluginsDir, THEME_PLUGIN_ID)
	try {
		await page.goto('/')

		// Written straight into the running server's own plugins folder,
		// the way a user drops a folder in from the Finder -- never a
		// plugin present at boot, which is the gap this spec closes.
		mkdirSync(pluginDir, { recursive: true })
		writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
			id: THEME_PLUGIN_ID,
			name: 'Theme probe',
			version: '1.0.0',
			capabilities: [],
			contributes: { themes: [{ id: 'dusk', label: 'Dusk', family: 'light', file: 'dusk.css' }] },
		}))
		writeFileSync(path.join(pluginDir, 'main.js'), 'export function activate() {}\n')
		writeFileSync(path.join(pluginDir, 'dusk.css'), `--bgColor-default: ${BG_TOKEN};\n`)

		// A freshly-scanned plugin is unallowed -- its theme waits behind
		// the same trust gate every other contribution does.
		await page.reload()
		const detail = await openPluginDetail(page, THEME_PLUGIN_ID)
		await expect(detail.getByTestId('extensions-plugin-review')).toBeVisible()
		await detail.getByTestId('extensions-plugin-allow').click()

		// Allowing a plugin does not run its code -- contributed themes
		// install per WINDOW, on mount -- so the picker only offers it
		// after the next paint picks the fresh trust state back up.
		await page.reload()
		await openSettings(page, 'appearance')
		await page.getByTestId('theme-mode-select').selectOption('single')
		const option = page.getByTestId(`single-theme-select-option-${SCHEME_ID}`)
		await expect(option).toBeVisible()
		await expect(option).toContainText('Dusk')
		await expect(option).toContainText('From Theme probe')
		await option.click()

		await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-light-theme'))).toBe(SCHEME_ID)
		await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-mill-scheme'))).toBe(SCHEME_ID)
		await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bgColor-default').trim())).toBe(BG_TOKEN)
	} finally {
		rmSync(pluginDir, { recursive: true, force: true })
		await close()
	}
})

test('an unchanged theme file imports as data, waits for Allow, and follows the full theme lifecycle', async () => {
	const { page, pluginsDir, close } = await launchWithPlugins(1, {
		ports: { server: RUNTIME_PLUGIN_THEMES_SERVER_BASE_PORT, mcp: RUNTIME_PLUGIN_THEMES_MCP_BASE_PORT },
	})
	const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'internal', 'services', 'pluginsvc', 'testdata', 'theme-import', 'catppuccin-3.18.1', 'latte.json')
	const importedID = 'imported-theme-light-c5739194f3d416a0056f507e'
	const importedScheme = `${importedID}.theme`
	const importedDir = path.join(pluginsDir, importedID)
	try {
		await page.goto('/')
		await openSettings(page, 'appearance')
		await page.getByTestId('theme-mode-select').selectOption('single')
		await page.getByTestId('single-theme-select-option-dark_dimmed').click()

		await page.getByRole('link', { name: 'Extensions' }).click()
		await page.getByTestId('extensions-import-theme').click()
		const dialog = page.getByRole('dialog', { name: 'Import theme' })
		await page.setViewportSize({ width: 480, height: 800 })
		await dialog.getByTestId('theme-import-file').setInputFiles(source)
		await expect(dialog.getByTestId('theme-import-name')).toHaveValue('Catppuccin Latte')
		await expect(dialog.getByTestId('theme-import-family')).toHaveValue('light')
		await expect(dialog.getByTestId('theme-import-summary')).toHaveText('Uses 14 of 564 interface colors.')
		await expect(dialog.getByTestId('theme-import-code-state')).toHaveText('Adds a color theme. Does not run code.')
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
		await page.setViewportSize({ width: 1280, height: 720 })
		await dialog.getByRole('button', { name: 'Import', exact: true }).click()
		await expect(dialog).toHaveCount(0)
		await expect(page.getByText('Theme imported. Allow it in Extensions to make it available in Appearance.')).toBeVisible()
		expect(existsSync(path.join(importedDir, 'source.json'))).toBe(true)

		const detail = await openPluginDetail(page, importedID)
		await expect(detail.getByTestId('extensions-detail-adds')).toContainText('Color themes: Catppuccin Latte')
		await expect(detail.getByTestId('extensions-theme-import-evidence')).toContainText('Imported from latte.json.')
		await expect(detail.getByTestId('extensions-theme-import-hash')).toContainText('c5739194f3d416a0056f507e016c369c1919ca77c2ae93709aaff64deffdf771')
		await page.setViewportSize({ width: 480, height: 800 })
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
		await page.setViewportSize({ width: 1280, height: 720 })
		await expect(detail.getByTestId('extensions-plugin-review')).toBeVisible()
		await detail.getByTestId('extensions-plugin-allow').click()

		// Allowing records consent; the next boot installs the data-only
		// contribution without ever requesting main.js.
		await page.reload()
		await openSettings(page, 'appearance')
		await expect(page.getByTestId('theme-mode-select')).toHaveValue('single')
		await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-mill-scheme'))).toBe('dark_dimmed')
		const option = page.getByTestId(`single-theme-select-option-${importedScheme}`)
		await expect(option).toContainText('Catppuccin Latte')

		// Hover crosses from a committed dark family into the imported
		// light family. Escape restores the committed choice.
		await option.hover()
		await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-mill-theme'))).toBe('light')
		await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bgColor-default').trim())).toBe('#eff1f5')
		await page.keyboard.press('Escape')
		await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-mill-scheme'))).toBe('dark_dimmed')

		await option.click()
		await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-mill-scheme'))).toBe(importedScheme)
		await page.reload()
		await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-mill-scheme'))).toBe(importedScheme)

		// A disabled contribution becomes unavailable and falls back after
		// the same reload lifecycle every installed extension uses.
		await openExtensions(page)
		const row = page.locator(`[data-testid="extensions-plugin-row"][data-plugin-id="${importedID}"]`)
		await row.getByTestId('extensions-plugin-toggle').click()
		await page.reload()
		await openSettings(page, 'appearance')
		await expect(page.getByTestId(`single-theme-select-option-${importedScheme}`)).toHaveCount(0)
		await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-mill-scheme'))).toBe('light')

		await openExtensions(page)
		await page.locator(`[data-testid="extensions-plugin-row"][data-plugin-id="${importedID}"]`).getByTestId('extensions-plugin-toggle').click()
		await page.reload()
		await openSettings(page, 'appearance')
		await expect(page.getByTestId(`single-theme-select-option-${importedScheme}`)).toBeVisible()
		await page.getByTestId(`single-theme-select-option-${importedScheme}`).click()

		const removeDetail = await openPluginDetail(page, importedID)
		await removeDetail.getByTestId('extensions-detail-menu').click()
		await page.getByTestId('extensions-detail-remove').click()
		await page.getByRole('button', { name: 'Remove', exact: true }).click()
		await expect(page.locator(`[data-testid="extensions-plugin-row"][data-plugin-id="${importedID}"]`)).toHaveCount(0)
		await page.reload()
		await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-mill-scheme'))).toBe('light')
	} finally {
		rmSync(importedDir, { recursive: true, force: true })
		await close()
	}
})
