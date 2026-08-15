import { test, expect } from './fixtures/server'
import { withClipboardLock } from './fixtures/clipboardLock'

// The three-pane step-detail overlay (docs/goals/0058): a canvas
// double-click or the sidebar's own expand button opens a large
// overlay showing a step's configuration beside its latest recorded
// input/output, in place of splitting that same information across the
// tiny sidebar and the separate Runs tab.

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

// See composition.spec.ts's own copy of this helper for the full
// reasoning (Primer's TabPanel keeps every open tab mounted, toggling
// `hidden` rather than unmounting).
function activePanel(page: import('@playwright/test').Page) {
  return page.locator('[role="tabpanel"]:not([hidden])').last()
}

function stepDetailOverlay(page: import('@playwright/test').Page) {
  return page.locator('[data-component="step-detail-overlay"]')
}

// See composition-canvas-interactions.spec.ts's own copy of this helper
// for the full reasoning: React Flow's fixed-position Controls/MiniMap
// chrome can sit on top of a node's own bounding-box center depending on
// layout, so this verifies (via elementFromPoint) that a candidate click
// point actually resolves inside the node's own card before using it.
// Finds a point PROVEN to land inside the node's own card (a candidate
// verified via document.elementFromPoint), the same defensive scan
// composition-canvas-interactions.spec.ts's clickCanvasNode uses --
// React Flow's own Controls (bottom-left) and MiniMap (bottom-right)
// are real drawn chrome that a Fit-View layout can place a node card
// underneath, so neither a plain center click nor a `force: true`
// click (which skips the browser's own hit-test, not Playwright's)
// reliably lands on the node itself.
async function pointInsideNode(page: import('@playwright/test').Page, panel: import('@playwright/test').Locator, label: string) {
  const node = panel.locator('.react-flow__node').filter({ hasText: label })
  const box = await node.boundingBox()
  if (!box) throw new Error(`pointInsideNode: node "${label}" has no bounding box`)
  const candidates = [
    { x: box.x + 10, y: box.y + 10 },
    { x: box.x + box.width - 10, y: box.y + 10 },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    { x: box.x + 10, y: box.y + box.height - 10 },
  ]
  for (const point of candidates) {
    const insideNode = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      return !!el?.closest('.react-flow__node')
    }, point)
    if (insideNode) return { node, point, box }
  }
  throw new Error(`pointInsideNode: no point for node "${label}" resolved inside its own card`)
}

// Double-clicks at a point already proven clear of overlapping canvas
// chrome, via Playwright's own locator.dblclick() (its full
// actionability pipeline -- scroll-into-view, stability, a second
// receives-events hit-test at the exact position -- rather than raw
// page.mouse coordinates, which round-tripped through this same node
// twice couldn't reliably reproduce a real double-click: selecting the
// node on the first sub-click expands the sidebar and can shift the
// node's own pixel position out from under an already-computed point
// before the second sub-click lands).
async function dblClickCanvasNode(page: import('@playwright/test').Page, panel: import('@playwright/test').Locator, label: string) {
  const { node, point, box } = await pointInsideNode(page, panel, label)
  await node.dblclick({ position: { x: point.x - box.x, y: point.y - box.y } })
}

// Real OS clipboard I/O (goal 0009): the seed's last step writes the
// real clipboard, serialized through the shared lock
// (.claude/rules/testing.md).
test('Double-clicking a step with a recorded run opens the overlay with real input/output; Esc closes it', async ({ page }) => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-stepdetail-'))
  const file = path.join(dir, 'page.html')
  fs.writeFileSync(file, '<nav>chrome nav</nav><main id="main-content"><h1>Captured Title</h1></main>')

  await withClipboardLock(async () => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Workflows' }).click()
    const row = workflowRow(page, 'Example: Saved page → Markdown')
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Run Example: Saved page → Markdown', exact: true }).click()

    const payloadField = page.getByTestId('test-run-payload')
    await expect(payloadField).toBeVisible()
    await payloadField.fill(file)
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(page.getByTestId('workflow-run-result')).toBeVisible({ timeout: 15_000 })

    await row.click()
    const panel = activePanel(page)
    await panel.getByRole('button', { name: 'Fit View' }).click()
    await page.waitForTimeout(300)
    await panel.getByRole('button', { name: 'Zoom Out' }).click()
    await page.waitForTimeout(200)

    await dblClickCanvasNode(page, panel, 'Process: HTML → Markdown')

    const overlay = stepDetailOverlay(page)
    await expect(overlay).toBeVisible()
    await expect(overlay).toContainText('Process: HTML → Markdown')
    // CONFIG pane: process-html-to-markdown takes no configuration --
    // the same generic Inspector copy the sidebar renders.
    await expect(overlay).toContainText('This step type takes no configuration.')
    // DATA panes: the latest recorded run's real input/output, not a
    // placeholder -- the main content survived, the dropped nav chrome
    // didn't.
    await expect(overlay.getByTestId('step-detail-input-payload')).toContainText('Captured Title', { timeout: 15_000 })
    await expect(overlay.getByTestId('step-detail-output-payload')).toContainText('Captured Title')
    await expect(overlay.getByTestId('step-detail-output-payload')).not.toContainText('chrome nav')

    await page.keyboard.press('Escape')
    await expect(overlay).toHaveCount(0)
  })
  fs.rmSync(dir, { recursive: true, force: true })
})

test('The sidebar expand button opens the same overlay; a step with no recorded run shows the empty state', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()

  const panel = activePanel(page)
  const nodes = panel.locator('.react-flow__node')
  await nodes.first().click()
  await expect(panel.getByTestId('open-step-detail')).toBeVisible()
  await panel.getByTestId('open-step-detail').click()

  const overlay = stepDetailOverlay(page)
  await expect(overlay).toBeVisible()
  // A brand-new, never-run workflow: both data panes read the empty
  // state, one line, nothing else.
  await expect(overlay.getByTestId('step-detail-input')).toContainText('Run this workflow to see real data here.')
  await expect(overlay.getByTestId('step-detail-output')).toContainText('Run this workflow to see real data here.')

  await overlay.getByRole('button', { name: 'Close' }).click()
  await expect(overlay).toHaveCount(0)
})
