// Framed plugin views (goal 0349): a view whose manifest names an entry
// page is that page, mounted in a sandboxed frame with no same-origin
// access. Its only door back to Mill is the postMessage bridge, so
// every assertion here drives the real page inside the real frame.
//
// Dedicated server pair (RUNTIME_PLUGIN_FRAME_*): the plugins dir is
// its own copy of examples/plugins and the notice pill reads the
// global notice list.
import { expect, test } from '@playwright/test'
import { launchWithPlugins, runFromPalette } from './fixtures/runtimePlugins'
import { RUNTIME_PLUGIN_FRAME_SERVER_BASE_PORT, RUNTIME_PLUGIN_FRAME_MCP_BASE_PORT } from './fixtures/serverPorts'
import { openSettings } from './fixtures/settingsNav'
import { gotoAppReady, waitForAppReady } from './fixtures/appReady'
import { callBindingViaRPC } from './fixtures/wailsRpc'

const PORTS = { server: RUNTIME_PLUGIN_FRAME_SERVER_BASE_PORT, mcp: RUNTIME_PLUGIN_FRAME_MCP_BASE_PORT }
const PLUGIN_STORAGE = 'github.com/alicoding/mill/internal/services/settingssvc.SettingsService.GetPluginStorage'
const GUARDRAIL = 'github.com/alicoding/mill/internal/services/guardrailsvc.GuardrailService.'
const ATLAS = 'github.com/alicoding/mill/internal/services/atlassvc.AtlasService.'

const PROBE_VIEW_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Frame probe</title></head>
<body>
  <button type="button" id="notify" data-testid="probe-notify">Notify</button>
  <button type="button" id="ping" data-testid="probe-ping">Ping</button>
  <button type="button" id="vscode" data-testid="probe-vscode">Ask through the editor shim</button>
  <button type="button" id="remember" data-testid="probe-remember">Remember</button>
  <div data-testid="probe-echo"></div>
  <div data-testid="probe-state"></div>
  <div data-testid="probe-token"></div>
  <script src="view.js"></script>
</body></html>`

const PROBE_VIEW_JS = `const mill = window.acquireMillApi()
const echo = document.querySelector('[data-testid="probe-echo"]')
const state = document.querySelector('[data-testid="probe-state"]')
const token = document.querySelector('[data-testid="probe-token"]')

const showToken = () => { token.textContent = getComputedStyle(document.documentElement).getPropertyValue('--fgColor-default').trim() }
showToken()
mill.on('theme:changed', showToken)

state.textContent = String(mill.getState() || '')
mill.onMessage((msg) => { echo.textContent = JSON.stringify(msg) })

document.getElementById('notify').addEventListener('click', () => { void mill.call('notify', { text: 'Sent from inside the frame.' }) })
document.getElementById('ping').addEventListener('click', () => { mill.postMessage({ ping: 1 }) })
document.getElementById('remember').addEventListener('click', () => { mill.setState('kept') })

const editor = window.acquireVsCodeApi()
document.getElementById('vscode').addEventListener('click', () => { editor.postMessage({ from: 'editor-shim' }) })
`

const JOT_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Jot</title></head>
<body>
  <input type="text" data-testid="jot-input">
  <button type="button" id="keep" data-testid="jot-keep">Keep it</button>
  <button type="button" id="drop" data-testid="jot-drop">Cancel</button>
  <div data-testid="jot-destination"></div>
  <script src="capture.js"></script>
</body></html>`

const JOT_JS = `const mill = window.acquireMillApi()
const input = document.querySelector('[data-testid="jot-input"]')
const destination = document.querySelector('[data-testid="jot-destination"]')

const showDestination = () => { destination.textContent = 'lands in: ' + JSON.stringify(mill.context.destinationId) }
showDestination()
mill.on('ctx', showDestination)

document.getElementById('keep').addEventListener('click', async () => {
  const written = await mill.call('content.createNote', { text: 'Jot: ' + input.value, parentId: mill.context.destinationId })
  if (written.approved) await mill.call('capture.done')
})
document.getElementById('drop').addEventListener('click', () => { void mill.call('capture.cancel') })
`

const THROWER_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Frame thrower</title></head>
<body><div data-testid="thrower-body">up</div><script src="throw.js"></script></body></html>`

const FRAME_PROBE = {
	id: 'frame-probe',
	manifest: {
		name: 'Frame probe',
		capabilities: ['write-content'],
		contributes: {
			views: [
				{ id: 'probe', title: 'Frame probe', entry: 'view.html' },
				{ id: 'thrower', title: 'Frame thrower', entry: 'thrower.html' },
			],
			captures: [{ id: 'jot', label: 'Jot', description: 'A quick line, written from its own page.', entry: 'capture.html' }],
		},
	},
	main: `export function activate(api) {
	const handle = api.registerView({
		id: 'probe',
		onMessage(message) { handle.postMessage({ echo: message }) },
	})
}
`,
	files: {
		'view.html': PROBE_VIEW_HTML,
		'view.js': PROBE_VIEW_JS,
		'capture.html': JOT_HTML,
		'capture.js': JOT_JS,
		'thrower.html': THROWER_HTML,
		'throw.js': `throw new Error('the page broke on purpose')`,
	},
}

test('a framed plugin view runs its own page, reaches Mill only through the bridge, and keeps its state across a reload', async () => {
	const { page, close } = await launchWithPlugins(0, { ports: PORTS, extraPlugins: [FRAME_PROBE] })
	try {
		await gotoAppReady(page)
		await runFromPalette(page, 'Frame probe')

		// The view IS an iframe, sandboxed without same-origin access.
		const host = page.getByTestId('plugin-view-frame-probe-probe')
		await expect(host).toBeVisible()
		await expect(host).toHaveAttribute('sandbox', 'allow-scripts allow-forms')
		await expect(host).toHaveAttribute('title', 'Frame probe')
		const frame = page.frameLocator('[data-testid="plugin-view-frame-probe-probe"]')

		// Mill's own tokens landed inside the page.
		await expect(frame.getByTestId('probe-token')).not.toHaveText('')
		const lightToken = await frame.getByTestId('probe-token').textContent()

		// A call over the bridge reaches the plugin's own notify door, and
		// the notice renders in Mill's footer with the plugin named.
		await frame.getByTestId('probe-notify').click()
		await expect(page.getByTestId('notice-text')).toContainText('Frame probe: Sent from inside the frame.')

		// The page posts to the plugin, the plugin posts back: the relay
		// both ways, through Mill, never a shared window.
		await frame.getByTestId('probe-ping').click()
		await expect(frame.getByTestId('probe-echo')).toHaveText('{"echo":{"ping":1}}')

		// The editor-webview shim is the same relay under the name a page
		// written for that editor already calls.
		await frame.getByTestId('probe-vscode').click()
		await expect(frame.getByTestId('probe-echo')).toHaveText('{"echo":{"from":"editor-shim"}}')

		// A theme change is pushed into the live page: the token block is
		// swapped in place, with no reload of the page.
		const settings = await page.context().newPage()
		await settings.goto('/')
		await openSettings(settings, 'appearance')
		await settings.getByRole('button', { name: 'Dark', exact: true }).click()
		await expect.poll(async () => frame.getByTestId('probe-token').textContent()).not.toBe(lightToken)
		await settings.close()

		// setState persists through the bridge into the plugin's own
		// storage, so a reload and a fresh mount read it back. The write
		// is durable before the reload, read from the store itself.
		await frame.getByTestId('probe-remember').click()
		await expect.poll(async () => {
			const stored = await callBindingViaRPC<Record<string, Record<string, string>>>(page, PLUGIN_STORAGE, [])
			return stored?.['frame-probe']?.['view:probe:state'] ?? ''
		}, { timeout: 8000 }).toBe('"kept"')
		await page.reload()
		await waitForAppReady(page)
		await runFromPalette(page, 'Frame probe')
		await expect(page.frameLocator('[data-testid="plugin-view-frame-probe-probe"]').getByTestId('probe-state')).toHaveText('kept')
	} finally {
		await close()
	}
})

test('a page that throws takes only its own frame down; Mill stays usable', async () => {
	const { page, close } = await launchWithPlugins(2, { ports: PORTS, extraPlugins: [FRAME_PROBE] })
	try {
		await gotoAppReady(page)
		await runFromPalette(page, 'Frame thrower')
		const host = page.getByTestId('plugin-view-frame-probe-thrower')
		await expect(host).toBeVisible()
		// The page still rendered its markup; only its script died.
		await expect(page.frameLocator('[data-testid="plugin-view-frame-probe-thrower"]').getByTestId('thrower-body')).toHaveText('up')

		// The app around it never noticed: the sidebar still navigates.
		await page.getByRole('link', { name: 'Atlas' }).click()
		await expect(page.getByTestId('atlas-board')).toBeVisible()
	} finally {
		await close()
	}
})

test('the Board index example ships its listing as an entry page, grouped or flat, with the choice remembered', async () => {
	const { page, close } = await launchWithPlugins(4, { ports: PORTS })
	try {
		await gotoAppReady(page)
		await runFromPalette(page, 'Board contents')
		const host = page.getByTestId('plugin-view-mill-index-contents')
		await expect(host).toBeVisible()
		await expect(host).toHaveAttribute('sandbox', 'allow-scripts allow-forms')
		const frame = page.frameLocator('[data-testid="plugin-view-mill-index-contents"]')

		// The listing came over the bridge's query door, grouped by kind.
		await expect(frame.getByTestId('index-list')).not.toHaveText('')
		await expect(frame.getByTestId('index-row').first()).toBeVisible()
		const grouping = frame.getByTestId('index-grouping')
		await expect(grouping).toHaveText('List by title')

		// The toggle is the page's own state, kept through the bridge.
		await grouping.click()
		await expect(grouping).toHaveText('Group by kind')
		await page.reload()
		await waitForAppReady(page)
		await runFromPalette(page, 'Board contents')
		await expect(page.frameLocator('[data-testid="plugin-view-mill-index-contents"]').getByTestId('index-grouping')).toHaveText('Group by kind')
	} finally {
		await close()
	}
})

// A framed CAPTURE is the identical contract in the capture window: the
// same entry page, the same bridge, plus the two controls only a
// capture has. The write parks like every plugin write.
test('a framed plugin capture writes through the guarded content door and closes itself', async () => {
	const { page, close } = await launchWithPlugins(6, { ports: PORTS, extraPlugins: [FRAME_PROBE] })
	try {
		await page.goto('/')
		await page.goto('about:blank')
		await page.goto('/#/capture?plugin=frame-probe&id=jot')
		const host = page.getByTestId('plugin-capture-frame-probe-jot')
		await expect(host).toBeVisible()
		await expect(host).toHaveAttribute('sandbox', 'allow-scripts allow-forms')
		const frame = page.frameLocator('[data-testid="plugin-capture-frame-probe-jot"]')

		// The capture's context reached the page, and follows the picker.
		await page.getByTestId('capture-destination').selectOption('')
		await expect(frame.getByTestId('jot-destination')).toHaveText('lands in: ""')

		await frame.getByTestId('jot-input').fill('framed and filed')
		await frame.getByTestId('jot-keep').click()
		await expect.poll(async () => (await callBindingViaRPC<{ ID: string }[]>(page, GUARDRAIL + 'PendingGuardedActions', [])).length).toBeGreaterThan(0)
		const pending = await callBindingViaRPC<{ ID: string }[]>(page, GUARDRAIL + 'PendingGuardedActions', [])
		await callBindingViaRPC(page, GUARDRAIL + 'ResolveGuardedAction', [pending[0].ID, true])
		await expect.poll(async () => {
			const notes = await callBindingViaRPC<{ Text: string; ParentID: string }[]>(page, ATLAS + 'Notes', [])
			return notes.find((n) => n.Text === 'Jot: framed and filed')?.ParentID ?? 'missing'
		}).toBe('')
	} finally {
		await close()
	}
})
