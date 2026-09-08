// Sandboxed activation for a third-party plugin with no canvas object
// (docs/goals/0349, docs/goals/0375 S1b): main.js runs inside its own
// hidden sandboxed frame, not Mill's document, reaching Mill only
// through the same bridged doors a framed view already has plus the
// registration doors (register.command/register.view) that turn a
// registerCommand/registerView call into a real host-side
// registration. Dedicated server (launchWithPlugins with a fixture
// plugin). Offset 74.
import { expect, test } from '@playwright/test'
import { launchWithPlugins, runFromPalette } from './fixtures/runtimePlugins'

const PANEL_HTML = `<!doctype html><html><head><meta charset="utf-8"></head>
<body><div data-testid="panel-body">Panel alive</div><script src="panel.js"></script></body></html>`
const PANEL_JS = `document.querySelector('[data-testid="panel-body"]').textContent = 'Panel alive'
`

const ACTIVATION_PROBE = {
	id: 'activation-probe',
	manifest: {
		name: 'Activation probe',
		contributes: {
			views: [{ id: 'panel', title: 'Activation panel', entry: 'panel.html' }],
		},
	},
	main: `export function activate(api) {
	api.registerView({ id: 'panel' })
	api.registerCommand({
		id: 'run-check',
		label: 'Run activation check',
		run: () => { api.notify({ level: 'success', text: 'Activation check ran, top!=window: ' + (window.top !== window) }) },
	})
}
`,
	files: { 'panel.html': PANEL_HTML, 'panel.js': PANEL_JS },
}

test('a framed third-party plugin registers a command and a view from inside its own sandboxed activation frame', async () => {
	const { page, close } = await launchWithPlugins(74, { extraPlugins: [ACTIVATION_PROBE] })
	try {
		await page.goto('/')
		await page.getByRole('link', { name: 'Atlas' }).click()
		await expect(page.getByTestId('atlas-board')).toBeVisible()

		// The activation frame exists, hidden (no plugin UI activates),
		// and its document is NOT Mill's own -- proven from the test's
		// own probe evaluated INSIDE that frame, not the plugin's word
		// for it.
		const activationFrame = page.locator('[data-testid="plugin-activation-frame-activation-probe"]')
		await expect(activationFrame).toHaveCount(1)
		await expect(activationFrame).toBeHidden()
		const contentFrame = activationFrame.contentFrame()
		const probe = contentFrame.locator(':root')
		expect(await probe.evaluate(() => window.top !== window)).toBe(true)
		// The frame's origin is opaque: reaching across to Mill's own
		// document throws instead of answering, the browser's own proof
		// of isolation, not something a plugin could fake from inside.
		await expect(probe.evaluate(() => window.top!.document)).rejects.toThrow(/cross-origin|SecurityError/)

		// The registered command runs from the palette; its result --
		// a notice posted from inside the frame, over the bridge --
		// lands in Mill's own document. The frame's own top!=window
		// check (evaluated inside main.js, not the test) agrees with the
		// probe above.
		await runFromPalette(page, 'Run activation check')
		await expect(page.getByTestId('notice-text')).toContainText('Activation check ran, top!=window: true')

		// The registered view opens framed too, on the SAME testid
		// convention a same-DOM view would carry.
		await runFromPalette(page, 'Activation panel')
		await expect(page.frameLocator('[data-testid="plugin-view-activation-probe-panel"]').getByTestId('panel-body')).toHaveText('Panel alive')
	} finally {
		await close()
	}
})
