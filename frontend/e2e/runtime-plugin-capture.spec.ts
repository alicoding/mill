// A plugin's capture (goal 0309): declared in the manifest, offered by
// the Quick Panel without running plugin code, rendered by the plugin
// in the capture window, landing through the guarded content door at
// the chosen destination. Dedicated server (launchWithPlugins with a
// fixture plugin). Offset 64.
import { expect, test } from '@playwright/test'
import { launchWithPlugins } from './fixtures/runtimePlugins'
import { callBindingViaRPC } from './fixtures/wailsRpc'

const GUARDRAIL = 'github.com/alicoding/mill/internal/services/guardrailsvc.GuardrailService.'
const ATLAS = 'github.com/alicoding/mill/internal/services/atlassvc.AtlasService.'

// Its own page (docs/goals/0375 S1b): quick-thought has no canvas
// object, so it activates framed and its capture needs an entry page
// (the install-time static check refuses one without).
const THOUGHT_HTML = `<!doctype html><html><head><meta charset="utf-8"></head>
<body><input type="text" data-testid="thought-input"><button type="button" data-testid="thought-keep">Keep it</button><script src="thought.js"></script></body></html>`
const THOUGHT_JS = `const mill = window.acquireMillApi()
const input = document.querySelector('[data-testid="thought-input"]')
document.querySelector('[data-testid="thought-keep"]').addEventListener('click', async () => {
	const r = await mill.call('content.createNote', { text: 'Thought: ' + input.value, parentId: mill.context.destinationId })
	if (r.approved) await mill.call('capture.done')
})
`
const CAPTURE_PLUGIN = {
	id: 'quick-thought',
	manifest: { name: 'Quick thought', capabilities: ['write-content'], contributes: { captures: [{ id: 'thought', label: 'Thought', description: 'A one-line thought.', entry: 'thought.html' }] } },
	main: 'export function activate() {}\n',
	files: { 'thought.html': THOUGHT_HTML, 'thought.js': THOUGHT_JS },
}

test('a plugin capture is offered by the Quick Panel and, in the capture window, lands a note at the chosen destination', async () => {
	const { page, close } = await launchWithPlugins(64, { extraPlugins: [CAPTURE_PLUGIN] })
	try {
		await page.goto('/')
		// The Quick Panel offers the row straight off the manifest.
		await page.goto('about:blank')
		await page.goto('/#/quickpanel')
		await expect(page.getByRole('option', { name: /New Thought…/ })).toBeVisible()

		await page.goto('about:blank')
		await page.goto('/#/capture?plugin=quick-thought&id=thought')
		const face = page.frameLocator('[data-testid="plugin-capture-quick-thought-thought"]')
		await expect(face.getByTestId('thought-input')).toBeVisible()
		await page.getByTestId('capture-destination').selectOption('')
		await face.getByTestId('thought-input').fill('ship it')
		await face.getByTestId('thought-keep').click()

		// The write parks like every plugin write; approve it from the
		// guardrail's own door and the note lands at the top level.
		await expect.poll(async () => (await callBindingViaRPC<{ ID: string }[]>(page, GUARDRAIL + 'PendingGuardedActions', [])).length).toBeGreaterThan(0)
		const pending = await callBindingViaRPC<{ ID: string }[]>(page, GUARDRAIL + 'PendingGuardedActions', [])
		await callBindingViaRPC(page, GUARDRAIL + 'ResolveGuardedAction', [pending[0].ID, true])
		await expect.poll(async () => {
			const notes = await callBindingViaRPC<{ Text: string; ParentID: string }[]>(page, ATLAS + 'Notes', [])
			return notes.find((n) => n.Text === 'Thought: ship it')?.ParentID ?? 'missing'
		}).toBe('')
	} finally {
		await close()
	}
})
