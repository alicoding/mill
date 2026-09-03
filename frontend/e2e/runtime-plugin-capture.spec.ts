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

const CAPTURE_PLUGIN = {
	id: 'quick-thought',
	manifest: { name: 'Quick thought', capabilities: ['write-content'], contributes: { captures: [{ id: 'thought', label: 'Thought', description: 'A one-line thought.' }] } },
	main: `export function activate(api) {
	api.registerCapture({
		id: 'thought',
		render(el, ctx) {
			const input = document.createElement('input')
			input.setAttribute('data-testid', 'thought-input')
			const button = document.createElement('button')
			button.textContent = 'Keep it'
			button.setAttribute('data-testid', 'thought-keep')
			button.onclick = () => {
				api.content.createNote({ text: 'Thought: ' + input.value, parentId: ctx.destinationId }).then((r) => { if (r.approved) ctx.done() })
			}
			el.append(input, button)
		},
	})
}
`,
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
		const face = page.getByTestId('capture-plugin-face')
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
