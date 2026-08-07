import { test, expect } from '@playwright/test'

// Real Go bindings over HTTP (Wails3 server mode), not mocks -- same
// setup/limitations as runbook.spec.ts (see its header comment):
// clipboard-dependent success content isn't assertable on a headless CI
// runner, so only the environment-independent path is checked here.
// Exercises SPEC.md §3 / ADR-0005's React Flow canvas (CompositionCanvas.tsx,
// built ahead of ADR-0005 B2's original deferral trigger -- see the ADR's
// Update section): CompositionService.NodeTypes()/Workflows()/
// CreateWorkflow()/DeleteWorkflow()/RunWorkflow() -> real drag-and-drop onto
// a React Flow canvas, not a form.

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="workflow-row"]', { has: page.getByText(label, { exact: true }) })
}

// Playwright's Locator.dragTo() simulates mouse events (mousedown/move/
// up), not the browser's native HTML5 Drag and Drop API -- confirmed
// directly, not assumed: it does not fire real dragstart/dragover/drop
// DOM events with a DataTransfer, so CompositionCanvas.tsx's
// onDragStart/onDrop handlers (which read event.dataTransfer) never see
// it. Dispatching the real DragEvents manually, as a real user's OS-
// level drag gesture would, is the only way to exercise this path.
async function dragPaletteItemToCanvas(page: import('@playwright/test').Page, label: string) {
  await page.evaluate((paletteLabel) => {
    const items = Array.from(document.querySelectorAll('[data-testid="palette-item"]'))
    const palette = items.find((el) => el.textContent?.includes(paletteLabel))
    const canvas = document.querySelector('[data-testid="composition-canvas"] .react-flow__pane')
    if (!palette || !canvas) {
      throw new Error(`drag setup failed: palette found=${!!palette} canvas found=${!!canvas}`)
    }
    const dataTransfer = new DataTransfer()
    const rect = canvas.getBoundingClientRect()
    const clientX = rect.x + rect.width / 2
    const clientY = rect.y + rect.height / 2
    palette.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }))
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }))
  }, label)
}

test('Composition page lists node primitives and built-in workflows', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()
  await expect(page.getByRole('heading', { name: 'Capability composition' })).toBeVisible()

  await expect(page.getByTestId('node-type-row')).toHaveCount(4)
  await expect(workflowRow(page, 'Load sample HTML')).toBeVisible()
  await expect(workflowRow(page, 'Clipboard → Markdown')).toBeVisible()
  await expect(workflowRow(page, 'Load sample HTML').getByText('built-in')).toBeVisible()

  // The workflow's step chain still renders as chips (walked from
  // Nodes/Edges in execution order, not a flat Steps array) -- the canvas
  // is the authoring surface, the saved-workflow list stays read-only.
  await expect(workflowRow(page, 'Clipboard → Markdown').getByText('Capture: clipboard HTML')).toBeVisible()
  // Configuration is visible as part of composition, not hidden: the
  // built-in's configured HTML value shows inline on its step chip.
  await expect(workflowRow(page, 'Load sample HTML').getByText(/html:/i)).toBeVisible()
})

test('Running the load-sample workflow produces a visible response, success or error', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()
  await workflowRow(page, 'Load sample HTML').getByRole('button', { name: 'Run' }).click()
  // Same environment caveat as runbook.spec.ts's load-sample-html test:
  // asserts the full click -> Go binding -> render pipeline produces SOME
  // response, without hard-coding osascript's platform-specific text.
  await expect(workflowRow(page, 'Load sample HTML').getByText(/Quarterly update|no HTML on clipboard|osascript/i)).toBeVisible()
})

test('Running the clipboard-to-markdown workflow produces a visible response, success or error', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()
  await workflowRow(page, 'Clipboard → Markdown').getByRole('button', { name: 'Run' }).click()
  // On headless CI this is deterministic (no HTML on the clipboard, same
  // as runbook.spec.ts's equivalent test) -- unlike Runbook's tuned
  // soft-failure copy, this prototype's ExecuteWorkflow surfaces a plain
  // technical error (composition.go's deliberate simplification). On a
  // real local desktop the composition tests share one live system
  // clipboard and can race, so -- exactly like runbook.spec.ts's own
  // load-sample-html test -- this accepts either real conversion or the
  // no-HTML error rather than asserting one deterministic outcome.
  await expect(workflowRow(page, 'Clipboard → Markdown').getByText(/no HTML on clipboard|Quarterly update|osascript/i)).toBeVisible()
})

test('Dragging a node onto the canvas configures it as it is added, then saves, runs and deletes for real', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()
  await expect(page.getByTestId('palette-item').first()).toBeVisible()

  await dragPaletteItemToCanvas(page, 'Apply: write HTML to clipboard')
  await expect(page.locator('.react-flow__node')).toHaveCount(1)

  // Clicking the dropped node surfaces its config fields immediately in
  // the Inspector -- composing and configuring happen together, not as
  // separate passes (docs/SPEC.md §3), just moved from inline-in-a-list-
  // row (the old form) to inline-on-select (the canvas).
  await page.locator('.react-flow__node').click()
  const inspector = page.getByTestId('composition-inspector')
  await expect(inspector).toContainText('Apply: write HTML to clipboard')

  const customHTML = '<p>e2e configured value</p>'
  const configField = page.getByTestId('canvas-config-field')
  await configField.fill(customHTML)
  await configField.blur()

  await page.getByLabel('Label').fill('E2E custom workflow')
  await page.getByLabel('Description').fill('Composed by an e2e test')
  await page.getByTestId('save-workflow').click()

  const row = workflowRow(page, 'E2E custom workflow')
  await expect(row).toBeVisible()
  await expect(row.getByText('built-in')).toHaveCount(0)
  // The configured (non-default) value is visible on the saved workflow,
  // not just the node type's label -- proves configuration survived
  // composition, not just the default.
  await expect(row.getByText(/e2e configured value/)).toBeVisible()

  // Running it writes the *configured* HTML, not the built-in default --
  // deterministic even in a headless CI runner: this node only writes to
  // the clipboard, it never reads from it.
  await row.getByRole('button', { name: 'Run' }).click()
  await expect(row.getByText(/e2e configured value/).last()).toBeVisible()

  await row.getByRole('button', { name: /Delete E2E custom workflow/ }).click()
  await expect(workflowRow(page, 'E2E custom workflow')).toHaveCount(0)
})

test('A single dropped node with no connections is a valid one-node workflow', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()
  await expect(page.getByTestId('palette-item').first()).toBeVisible()

  // Zero edges is correct for exactly one node (linearOrder/the zod
  // schema both require len(Edges) === len(Nodes)-1) -- confirms a lone
  // node isn't rejected as "disconnected."
  await dragPaletteItemToCanvas(page, 'Capture: clipboard HTML')
  await expect(page.locator('.react-flow__node')).toHaveCount(1)

  await page.getByLabel('Label').fill('E2E single-node workflow')
  await page.getByTestId('save-workflow').click()

  const row = workflowRow(page, 'E2E single-node workflow')
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: /Delete E2E single-node workflow/ }).click()
  await expect(row).toHaveCount(0)
})

test('Built-in workflows have no delete control', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()
  await expect(workflowRow(page, 'Load sample HTML').getByRole('button', { name: /Delete/ })).toHaveCount(0)
})
