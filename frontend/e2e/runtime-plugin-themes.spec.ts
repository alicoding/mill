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
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { launchWithPlugins } from './fixtures/runtimePlugins'
import { openPluginDetail, openSettings } from './fixtures/settingsNav'
import { RUNTIME_PLUGIN_THEMES_MCP_BASE_PORT, RUNTIME_PLUGIN_THEMES_SERVER_BASE_PORT } from './fixtures/serverPorts'

const THEME_PLUGIN_ID = 'theme-probe'
const SCHEME_ID = `${THEME_PLUGIN_ID}.dusk`
const BG_TOKEN = '#221133'

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
		await page.getByRole('button', { name: 'Light', exact: true }).click()
		const option = page.getByTestId(`light-scheme-select-option-${SCHEME_ID}`)
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
