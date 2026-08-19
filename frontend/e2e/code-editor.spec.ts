import { test, expect } from './fixtures/server'
import { activePanel, dragPaletteItemToCanvas } from './fixtures/canvas'
import { clickCanvasNode } from './fixtures/canvasNode'
import { fillCodeEditor } from './fixtures/codeEditor'

// Cross-cutting CodeEditor behavior (goal 0120) verified against real
// call sites, rather than a synthetic host -- shared/CodeEditor.tsx has
// no standalone route of its own, so its properties are proven through
// the flagship fields that actually render it.

test('code-execution\'s script field renders CodeMirror with line numbers', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'code-execution')

  const panel = activePanel(page)
  await clickCanvasNode(page, panel, 'Run a command')

  const script = panel.getByTestId('code-execution-script')
  await expect(script.locator('.cm-content')).toBeVisible()
  await expect(script.locator('.cm-gutter')).toBeVisible()
})

test('ruleset\'s "Edit as JSON" fallback feeds back into the structured rule list', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'ruleset')

  const panel = activePanel(page)
  await clickCanvasNode(page, panel, 'Validate with rules')

  await panel.getByTestId('ruleset-toggle-json').click()
  await fillCodeEditor(page, 'ruleset-json-editor', JSON.stringify([{ name: 'has amount', condition: 'Attributes["amount"] > 0' }]))
  // Blur commits the draft (CodeConfigField's own contract) -- clicking
  // the heading moves focus off the editor without touching the rules.
  await panel.getByText('Rules', { exact: true }).click()

  await expect(panel.getByTestId('ruleset-rule-name')).toHaveValue('has amount')
})

test('the Try-it output stays readonly', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'process-html-to-markdown')

  const panel = activePanel(page)
  await clickCanvasNode(page, panel, 'Convert HTML to Markdown')

  await fillCodeEditor(page, 'try-html-input', '<p>hello</p>')
  await panel.getByTestId('try-convert').click()

  const output = panel.getByTestId('try-markdown-output')
  await expect(output).toContainText('hello')

  const before = await output.locator('.cm-content').textContent()
  await output.locator('.cm-content').click()
  await page.keyboard.type('this should not appear')
  await expect(output.locator('.cm-content')).toHaveText(before ?? '')
})
