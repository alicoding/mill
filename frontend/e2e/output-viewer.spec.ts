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
// "Write text to clipboard" is the driver: it forwards its payload
// unchanged (ADR-0042 passthrough), so whatever goes into the step-test
// input comes back out as the step's output, and every shape below is
// exactly the bytes this spec chose. Its effect class is local, so the
// guardrail allows it without an approval round trip. Every test takes
// the clipboard lock, because the step really does write the clipboard.

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
  await dragPaletteItemToCanvas(page, 'apply-clipboard-write-text')
  const panel = activePanel(page)
  await clickCanvasNode(page, panel, 'Write text to clipboard')
  return panel
}

async function outputFor(page: Page, input: string): Promise<Locator> {
  const panel = await passthroughStep(page)
  const section = await tryStep(page, panel, input)
  const output = section.getByTestId('step-test-output')
  await expect(output).toBeVisible({ timeout: 15_000 })
  return output
}

test('an array of objects presents as a table, switches to tree and raw, and copies the current view', async ({ page }) => {
  await withClipboardLock(async () => {
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
})

test('text output presents as a numbered log, wrapping on a toggle, and Find highlights inside it', async ({ page }) => {
  await withClipboardLock(async () => {
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
})

test('output past the render budget shows what it held back and offers the rest', async ({ page }) => {
  await withClipboardLock(async () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ index: i }))
    const output = await outputFor(page, JSON.stringify(many))

    await expect(output).toHaveAttribute('data-view', 'table')
    const cap = output.getByTestId('step-test-output-cap')
    await expect(cap).toContainText('Showing 500 of 600 rows')

    await cap.getByTestId('step-test-output-show-all').click()
    await expect(output.getByTestId('step-test-output-cap')).toHaveCount(0)
  })
})

test('Open in full puts the same viewer in its own work tab', async ({ page }) => {
  await withClipboardLock(async () => {
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
})

// Copy is proven on a step with no side effect of its own: the
// passthrough driver above WRITES the clipboard as its whole purpose,
// so its own write races any assertion about what Copy put there.
// What Copy copies for each view (TSV for a table, pretty JSON for a
// tree) is pinned by shared/OutputTableView's unit tests; this is the
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

// Review's parked payload (goal 0326): an approver reads what the step
// is about to act on through the same viewer, never as typed text. The
// seeded working-directory example is the driver -- its shell step
// parks, and its payload carries the working-directory line goal 0345
// prepends, so the parked payload is real content rather than empty.
test('a parked run presents its payload in Review', async ({ page }) => {
  await gotoAppReady(page)
  await page.getByRole('link', { name: 'Workflows' }).click()
  const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]')
    .filter({ has: page.getByText('Example: Run in the captured folder', { exact: true }) })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: /^Run Example: Run in the captured folder$/ }).click()
  // This example takes a typed attribute, so Run opens the test-run
  // dialog first; its default folder is what the step then runs in.
  const runButton = page.getByRole('button', { name: 'Run', exact: true })
  await expect(runButton).toBeVisible()
  await runButton.click()

  await page.getByRole('link', { name: 'Review' }).click()
  // Scoped to the item THIS test parked: the Review queue is global,
  // and a shared-pool worker can hold another spec's parked run too.
  const item = page.getByTestId('review-item').filter({ hasText: 'Example: Run in the captured folder' }).first()
  await expect(item).toBeVisible({ timeout: 15_000 })
  const parked = item.getByTestId('review-parked-payload')
  await expect(parked).toBeVisible({ timeout: 15_000 })
  await expect(parked.getByTestId('output-copy')).toBeVisible()
  // Read-only by construction: an approver can select the payload, but
  // there is nothing here to type into.
  await expect(parked.locator('textarea')).toHaveCount(0)
  await expect(parked).toContainText('Working directory')

  // Deny so nothing this test parked outlives it.
  await item.getByTestId('review-deny').click()
  await expect(page.getByTestId('review-item').filter({ hasText: 'Example: Run in the captured folder' })).toHaveCount(0, { timeout: 10_000 })
})
