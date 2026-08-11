import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'

// docs/adr/0028's authoring-validation panel + the severity contract
// (errors block save, warnings never do), driven through the real
// canvas -- not just the Go-level ValidateGraph/ValidateGraphStrict
// unit tests (internal/domain/composition/graph_test.go). Covers the
// three acceptance scenarios named in goal 0008: (a) the owner's own
// demonstrated repro (a workflow whose root isn't a Trigger) can no
// longer save, with the error named in the issues panel; (b) a
// trigger-rooted workflow ending in a Process leaf saves anyway, with
// a visible warning on both the toolbar badge and the node itself, and
// clicking the panel row selects that node; (c) an existing seeded
// workflow that already ends in a Process leaf shows the same warning
// live, proving nothing else broke.

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

// See composition.spec.ts's own copy of this helper for the full
// reasoning (Primer's TabPanel keeps every open tab mounted, toggling
// `hidden` rather than unmounting).
function activePanel(page: import('@playwright/test').Page) {
  return page.locator('[role="tabpanel"]:not([hidden])').last()
}

// See composition.spec.ts's own copy of this helper for the full
// reasoning (Locator.dragTo() doesn't fire real HTML5 DnD events, so
// the palette's onDragStart/onDrop handlers need manually-dispatched
// DragEvents instead).
async function dragPaletteItemToCanvas(page: import('@playwright/test').Page, nodeTypeID: string) {
  await page.evaluate((id) => {
    const panel = document.querySelector('[role="tabpanel"]:not([hidden])')
    if (!panel) throw new Error('no active tabpanel')
    const palette = panel.querySelector(`[data-node-type-id="${id}"]`)
    const canvas = panel.querySelector('.react-flow__pane')
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
  }, nodeTypeID)
}

// Removes the pre-populated starter node -- test (a) needs an exact,
// known single-node graph (a lone Capture, no Trigger at all), not
// "the starter plus whatever I added."
async function deleteStarterNode(page: import('@playwright/test').Page) {
  await activePanel(page).locator('.react-flow__node').click()
  await activePanel(page).getByRole('button', { name: 'Delete selected' }).click()
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(0)
}

// See composition-canvas-interactions.spec.ts's own copy of this helper
// for the full reasoning (Fit View first avoids the MiniMap-overlap
// hazard a spiral-placed node's handle can land under).
async function connectNodes(page: import('@playwright/test').Page, sourceLabel: string, targetLabel: string) {
  const panel = activePanel(page)
  await panel.getByRole('button', { name: 'Fit View' }).click()
  await page.waitForTimeout(300)
  const sourceHandle = panel.locator('.react-flow__node').filter({ hasText: sourceLabel }).locator('.react-flow__handle.source')
  const targetHandle = panel.locator('.react-flow__node').filter({ hasText: targetLabel }).locator('.react-flow__handle.target')
  const sourceBox = await sourceHandle.boundingBox()
  const targetBox = await targetHandle.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('connectNodes: handle bounding box not found')
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 })
  await page.mouse.up()
}

// The debounced ValidateDraft round trip (useDraftValidation.ts: 500ms
// debounce + a real RPC) needs real slack beyond the debounce itself.
const VALIDATION_TIMEOUT = 5_000

test('The owner\'s repro: a workflow whose root is not a Trigger cannot be saved, with the error named in the issues panel', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await deleteStarterNode(page)
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'capture-clipboard-html')
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(1)

  // Nothing hidden: the badge already flags this before Save is even
  // clicked. One error (non-Trigger root) plus one warning (the lone
  // Capture node is also a dangling leaf).
  const badge = activePanel(page).getByTestId('validation-badge')
  await expect(badge).toBeVisible({ timeout: VALIDATION_TIMEOUT })
  await expect(badge).toContainText('1 error')

  await badge.click()
  // AnchoredOverlay portals its content outside the tabpanel's own DOM
  // subtree (same as WorkflowHoverPreview.tsx/clickRowAction's own
  // documented reasoning) -- looked up at the page level, not scoped to
  // activePanel().
  const panel = page.getByTestId('validation-panel')
  await expect(panel).toBeVisible()
  const rootIssue = panel.getByTestId('validation-issue').filter({ hasText: 'must start with a Trigger step' })
  await expect(rootIssue).toBeVisible()
  await expect(rootIssue).toHaveAttribute('data-severity', 'error')

  await activePanel(page).getByLabel('Label').fill('E2E non-trigger-root repro')
  await activePanel(page).getByTestId('save-workflow').click()
  await expect(activePanel(page).getByText(/must start with a Trigger step/)).toBeVisible()

  // Rejected means nothing was actually saved.
  await page.getByRole('tab', { name: 'Workflows' }).click()
  await expect(workflowRow(page, 'E2E non-trigger-root repro')).toHaveCount(0)
})

test('A Trigger -> Process-leaf workflow saves with a warning; the toolbar and node both badge it, and the panel row selects the node', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()

  // Keep the starter trigger-manual node -- connect it straight into a
  // Process node with nothing downstream, exactly the "computed
  // something, delivered it nowhere" warning shape (docs/adr/0028).
  await dragPaletteItemToCanvas(page, 'process-inject-text')
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(2)
  await connectNodes(page, 'Trigger: manual', 'Process: Inject text')
  await expect(activePanel(page).locator('.react-flow__edge')).toHaveCount(1)

  const badge = activePanel(page).getByTestId('validation-badge')
  await expect(badge).toBeVisible({ timeout: VALIDATION_TIMEOUT })
  await expect(badge).toContainText('warning')
  await expect(badge).not.toContainText('error')

  const nodeBadge = activePanel(page).getByTestId('node-validation-badge')
  await expect(nodeBadge).toHaveCount(1)
  await expect(nodeBadge).toHaveAttribute('data-severity', 'warning')

  await badge.click()
  const panel = page.getByTestId('validation-panel')
  await expect(panel).toBeVisible()
  const leafIssue = panel.getByTestId('validation-issue').filter({ hasText: "isn't delivered anywhere" })
  await expect(leafIssue).toBeVisible()
  await expect(leafIssue).toHaveAttribute('data-severity', 'warning')

  // Clicking the issue selects its node -- proven by the Inspector now
  // showing that node's own type, not "select a node to configure it."
  await leafIssue.click()
  await expect(activePanel(page).getByTestId('composition-inspector')).toContainText('Process: Inject text')

  // Legal to save despite the warning (errors block, warnings never do).
  await activePanel(page).getByLabel('Label').fill('E2E process-leaf workflow')
  await activePanel(page).getByTestId('save-workflow').click()
  const row = workflowRow(page, 'E2E process-leaf workflow')
  await expect(row).toBeVisible()

  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
})

test('An existing seed ending in a Process leaf (Example: Approval-gated HTTP call) shows the same warning live, nothing else broken', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText('Example: Approval-gated HTTP call', { exact: true }) })
  await expect(row).toBeVisible()
  await row.click()

  const badge = activePanel(page).getByTestId('validation-badge')
  await expect(badge).toBeVisible({ timeout: VALIDATION_TIMEOUT })
  await expect(badge).toContainText('1 warning')
  await expect(badge).not.toContainText('error')

  // Coexists cleanly with this same seed's own guardrail "ask" badge
  // (guardrail.spec.ts) -- distinct icon/position, both visible at once.
  await expect(activePanel(page).getByTestId('node-validation-badge')).toHaveAttribute('data-severity', 'warning')
  await expect(activePanel(page).getByTestId('canvas-guardrail-badge')).toHaveAttribute('data-effect', 'ask')
})
