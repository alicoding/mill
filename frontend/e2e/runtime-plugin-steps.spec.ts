// The "perform" step-pack door (ADR-0051 §5, goal 0305 slice 4b): a
// plugin's declared steps join the palette and run inside Mill's
// executor through steps.js -- proven through the step-test surface
// (the same exec a run calls) and the Extensions row. Dedicated server
// (launchWithPlugins with the Text case example added). Offset 52.
import { expect, test } from '@playwright/test'
import { launchWithPlugins } from './fixtures/runtimePlugins'
import { clickCanvasNode } from './fixtures/canvasNode'
import { activePanel, dragPaletteItemToCanvas } from './fixtures/canvas'
import { stepOutput, tryStep } from './fixtures/stepTest'

test('a plugin step appears in the palette with its declared config and runs through steps.js', async () => {
	const { page, close } = await launchWithPlugins(52, { extraExamples: ['mill-textcase'] })
	try {
		await page.goto('/')
		await page.getByRole('link', { name: 'Settings' }).click()
		const row = page.locator('[data-testid="extensions-plugin-row"][data-plugin-id="mill-textcase"]')
		await row.scrollIntoViewIfNeeded()
		await expect(row.getByTestId('extensions-plugin-steps')).toHaveText('Adds workflow steps: Text case')

		await page.getByRole('link', { name: 'Workflows' }).click()
		await page.getByTestId('new-workflow').click()
		await activePanel(page).getByTestId('toggle-palette').click()
		await dragPaletteItemToCanvas(page, 'process-mill-textcase-text-case')
		const panel = activePanel(page)
		await clickCanvasNode(page, panel, 'Text case')
		// The declared option field renders with its default.
		const mode = panel.getByRole('combobox', { name: 'Mode' })
		await expect(mode).toHaveValue('upper')
		const section = await tryStep(page, panel, 'hello mill')
		await expect(await stepOutput(section)).toContainText('HELLO MILL')
		await mode.selectOption('title')
		const again = await tryStep(page, panel, 'hello mill')
		await expect(await stepOutput(again)).toContainText('Hello Mill')
	} finally {
		await close()
	}
})
