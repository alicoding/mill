// Extension interop (docs/goals/0364): a declared dependency's
// exported surface, reachable through api.extensions.get(id) only --
// never a live handle into an extension you did not declare (Obsidian's
// confirmed anti-pattern). Dedicated server per test, the same reason
// every runtime-plugin spec has one (MILL_PLUGINS_DIR is process-wide).
// Offsets 90/92/96 (o-20 and o+20 both unclaimed by the shared offset
// space, per fixtures/runtimePlugins.ts's own picking rule).
import { expect, test } from '@playwright/test'
import { launchWithPlugins, runFromPalette, type ExtraPlugin } from './fixtures/runtimePlugins'
import { openExtensionDetail, openExtensions, pluginRow } from './fixtures/settingsNav'

// A one-off fixture plugin (never "mill-"-prefixed: it ships nowhere,
// unlike the two mill-interop-* examples) proving the callee-side gate:
// it never declares mill-interop-provider as a dependency, so
// api.extensions.get must resolve undefined for it, whatever it asks.
const OUTSIDER: ExtraPlugin = {
	id: 'interop-outsider',
	manifest: { name: 'Interop outsider' },
	main: `export function activate(api) {
	api.registerCommand({
		id: 'try-reach',
		label: 'Try reaching the provider without declaring it',
		run: async () => {
			const provider = await api.extensions.get('mill-interop-provider')
			api.notify({ level: provider ? 'error' : 'success', text: provider ? 'Got a live object!' : 'Got undefined, as the gate requires.' })
		},
	})
}
`,
}

test('a framed dependant calls its declared dependency\'s exported method across both activation frames', async () => {
	const { page, close } = await launchWithPlugins(90, { extraExamples: ['mill-interop-provider', 'mill-interop-consumer'] })
	try {
		await page.goto('/')
		// The shell must be mounted before the palette shortcut can land.
		await expect(page.getByRole('link', { name: 'Atlas' })).toBeVisible()
		await runFromPalette(page, 'Greet the interop provider')
		await expect(page.getByTestId('notice-text')).toContainText('Hello, Mill! (from mill-interop-provider)')
	} finally {
		await close()
	}
})

test('a plugin that never declared the dependency gets undefined, never the live object', async () => {
	const { page, close } = await launchWithPlugins(92, { extraExamples: ['mill-interop-provider'], extraPlugins: [OUTSIDER] })
	try {
		await page.goto('/')
		// The shell must be mounted before the palette shortcut can land.
		await expect(page.getByRole('link', { name: 'Atlas' })).toBeVisible()
		await runFromPalette(page, 'Try reaching the provider without declaring it')
		await expect(page.getByTestId('notice-text')).toContainText('Got undefined, as the gate requires.')
	} finally {
		await close()
	}
})

test('a dependant whose dependency never activated waits, named on its Extensions row and detail pane', async () => {
	const { page, close } = await launchWithPlugins(96, { extraExamples: ['mill-interop-consumer'] })
	try {
		await page.goto('/')
		await openExtensions(page)
		const row = pluginRow(page, 'mill-interop-consumer')
		await expect(row.getByTestId('extensions-row-waits')).toHaveText('Waits for mill-interop-provider')

		const detail = await openExtensionDetail(page, row, 'mill-interop-consumer')
		await expect(detail.getByTestId('extensions-plugin-waits')).toContainText('Waits for mill-interop-provider to run first.')
	} finally {
		await close()
	}
})
