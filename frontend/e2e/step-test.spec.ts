// The step-test surface (ADR-0051 §5, goal 0305): any step runs alone
// on an input from the Inspector, without the workflow running; a step
// the guardrail would ask about is refused with the reason, never run.
// Shared worker pool: every test opens its own never-saved draft and
// asserts only on what it dropped.
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/server'
import { clickCanvasNode } from './fixtures/canvasNode'
import { activePanel, dragPaletteItemToCanvas } from './fixtures/canvas'
import { stepOutput, tryStep } from './fixtures/stepTest'

async function openPaletteOnNewWorkflow(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
}

test('a pure step runs alone on typed input and shows its output in place', async ({ page }) => {
  await openPaletteOnNewWorkflow(page)
  await dragPaletteItemToCanvas(page, 'process-transform-text')
  const panel = activePanel(page)
  await clickCanvasNode(page, panel, 'Transform text')
  // No run has reached this draft's step: the replay fill is off.
  await expect(panel.getByTestId('step-test-use-last-run')).toBeDisabled()
  const section = await tryStep(page, panel, 'abc')
  // The step's default operation is SHA-256.
  await expect(await stepOutput(section)).toContainText('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('a step the guardrail would ask about is refused with the reason, never run', async ({ page }) => {
  await openPaletteOnNewWorkflow(page)
  await dragPaletteItemToCanvas(page, 'process-shell-command')
  const panel = activePanel(page)
  await clickCanvasNode(page, panel, 'Run a captured command')
  const section = await tryStep(page, panel, '$ whoami')
  const refused = section.getByTestId('step-test-refused')
  await expect(refused).toContainText('asks for approval before it runs')
  await expect(refused).toContainText('Run the workflow to approve it')
  await expect(section.getByTestId('step-test-output')).toHaveCount(0)
})
