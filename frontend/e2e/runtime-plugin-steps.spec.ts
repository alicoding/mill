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
import { openPluginDetail } from './fixtures/settingsNav'
import { openInspectorTab } from './fixtures/inspectorTabs'

test('a plugin step appears in the palette with its declared config and runs through steps.js', async () => {
	const { page, close } = await launchWithPlugins(52, { extraExamples: ['mill-textcase'] })
	try {
		await page.goto('/')
		const detail = await openPluginDetail(page, 'mill-textcase')
		await expect(detail.getByTestId('extensions-detail-adds')).toContainText('Workflow steps: Text case')

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
		// Try this step leaves the Test tab open; the Mode field lives on Parameters.
		await openInspectorTab(panel, 'parameters')
		await mode.selectOption('title')
		const again = await tryStep(page, panel, 'hello mill')
		await expect(await stepOutput(again)).toContainText('Hello Mill')
	} finally {
		await close()
	}
})
