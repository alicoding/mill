import { test, expect, type Page, type Locator } from './fixtures/server'
import { activePanel, dragPaletteItemToCanvas } from './fixtures/canvas'
import { clickCanvasNode } from './fixtures/canvasNode'
import { withClipboardLock } from './fixtures/clipboardLock'
import { tryStep } from './fixtures/stepTest'
import { gotoAppReady } from './fixtures/appReady'

// The one output surface (goal 0326), driven end to end through a real
// step run rather than a synthetic host -- shared/OutputViewer.tsx has
// no route of its own, so its behaviour is proven where it actually
// renders.
//
// "Validate with rules" is the driver: with no rules configured it
// forwards its payload unchanged (ADR-0042 passthrough), so whatever
// goes into the step-test input comes back out as the step's output,
// and every shape below is exactly the bytes this spec chose. It
// touches nothing outside the process and its effect class is none, so
// it needs no approval and no machine-level facility a headless runner
// might lack.

// Drops a passthrough step on a fresh canvas and returns its inspector
// panel. Nothing is saved: a test run needs a node, not a workflow.
async function passthroughStep(page: Page): Promise<Locator> {
  // Playwright's own clipboard permissions, so a Copy assertion can
  // read back what the button wrote (the same grant copy-diagnosis.spec
  // and atlas-share.spec take).
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await gotoAppReady(page)
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'ruleset')
  const panel = activePanel(page)
  await clickCanvasNode(page, panel, 'Validate with rules')
  return panel
}

async function outputFor(page: Page, input: string): Promise<Locator> {
  const panel = await passthroughStep(page)
  const section = await tryStep(page, panel, input)
  const output = section.getByTestId('step-test-output')
  await expect(output).toBeVisible({ timeout: 15_000 })
  return output
}

test('an array of objects presents as a table, and switches to tree and raw', async ({ page }) => {
  const rows = JSON.stringify([
    { name: 'alpha', status: 'ok' },
    { name: 'beta', status: 'failed' },
  ])
  const output = await outputFor(page, rows)

  // Nothing declared the shape, so the viewer worked it out and says
  // so on the item it chose.
  await expect(output).toHaveAttribute('data-shape', 'rows')
  await expect(output).toHaveAttribute('data-view', 'table')
  await expect(output.getByTestId('output-view-table')).toHaveAttribute('title', 'Detected as Table')
  await expect(output).toContainText('alpha')
  await expect(output).toContainText('failed')

  // Every alternate is one click away, Raw always among them.
  await output.getByTestId('output-view-tree').click()
  await expect(output).toHaveAttribute('data-view', 'tree')
  await expect(output.getByTestId('json-tree-node')).toHaveCount(2)

  await output.getByTestId('output-view-raw').click()
  await expect(output).toHaveAttribute('data-view', 'raw')
  await expect(output.getByTestId('step-test-output-raw')).toContainText('"status"')

  await output.getByTestId('output-view-table').click()
  await expect(output).toHaveAttribute('data-view', 'table')
})

test('text output presents as a numbered log, wrapping on a toggle, and Find highlights inside it', async ({ page }) => {
  // ESC-bracket sequences are what a real shell step emits; the log
  // renders them as colour rather than printing the escape.
  const esc = String.fromCharCode(27)
  const output = await outputFor(page, `first line\n${esc}[32msecond${esc}[0m line with needle\nthird line`)

  await expect(output).toHaveAttribute('data-shape', 'text')
  await expect(output).toHaveAttribute('data-view', 'log')
  await expect(output.getByTestId('output-log-line')).toHaveCount(3)
  await expect(output.locator('.ansi-green')).toHaveText('second')
  await expect(output).not.toContainText('[32m')

  // Wrap is a real toggle, and it belongs to the text views only.
  const wrap = output.getByTestId('output-wrap')
  await expect(wrap).toHaveAttribute('aria-pressed', 'true')
  await wrap.click()
  await expect(wrap).toHaveAttribute('aria-pressed', 'false')

  await output.getByTestId('output-find').click()
  await output.getByTestId('output-find-field').fill('needle')
  await expect(output.locator('mark')).toHaveCount(1)
  await expect(output.locator('mark')).toHaveText('needle')

  // Escape closes Find and clears what it highlighted.
  await output.getByTestId('output-find-field').press('Escape')
  await expect(output.getByTestId('output-find-field')).toHaveCount(0)
  await expect(output.locator('mark')).toHaveCount(0)
})

test('output past the render budget shows what it held back and offers the rest', async ({ page }) => {
  const many = Array.from({ length: 600 }, (_, i) => ({ index: i }))
  const output = await outputFor(page, JSON.stringify(many))

  await expect(output).toHaveAttribute('data-view', 'table')
  const cap = output.getByTestId('step-test-output-cap')
  await expect(cap).toContainText('Showing 500 of 600 rows')

  await cap.getByTestId('step-test-output-show-all').click()
  await expect(output.getByTestId('step-test-output-cap')).toHaveCount(0)
})

test('Open in full puts the same viewer in its own work tab', async ({ page }) => {
  const output = await outputFor(page, JSON.stringify({ receipt: { status: 'ok' } }))
  await expect(output).toHaveAttribute('data-view', 'tree')

  await output.getByTestId('output-open-full').click()
  const full = page.getByTestId('output-full')
  await expect(full).toBeVisible()
  await expect(full).toHaveAttribute('data-view', 'tree')
  // The full view has nothing bigger to open into, so it offers no
  // Open in full of its own.
  await expect(full.getByTestId('output-open-full')).toHaveCount(0)
  await expect(full).toContainText('receipt')

  // The tab carries the output's own title, not a generic one.
  await expect(page.getByRole('tab', { name: 'Step output' })).toBeVisible()
  await page.getByRole('button', { name: 'Close tab' }).last().click()
  await expect(page.getByTestId('output-full')).toHaveCount(0)
})

// What Copy copies for each view (TSV for a table, pretty JSON for a
// tree) is pinned by shared/outputTable's unit tests; this is the
// wiring, end to end.
test('Copy puts the output on the clipboard', async ({ page }) => {
  await withClipboardLock(async () => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await gotoAppReady(page)
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'process-html-to-markdown')
  const panel = activePanel(page)
  await clickCanvasNode(page, panel, 'Convert HTML to Markdown')

  const section = await tryStep(page, panel, '<h1>Copied heading</h1>')
  const output = section.getByTestId('step-test-output')
  await expect(output).toBeVisible({ timeout: 15_000 })
  // A converter's own test panel reads the markdown it produced, so
  // it opens on the source; Rendered stays one click away.
  await expect(output).toHaveAttribute('data-shape', 'markdown')
  await expect(output).toHaveAttribute('data-view', 'source')

  await output.getByTestId('output-copy').click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 10_000 })
    .toContain('# Copied heading')
  })
})
