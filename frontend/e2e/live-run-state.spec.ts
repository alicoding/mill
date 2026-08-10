import { test, expect } from '@playwright/test'
import { clickRowAction } from './inventoryRow'

// Live run state on the authoring canvas (docs/SPEC.md §3.8's recorded
// prototype element #2): DONE/ACTIVE/PENDING per node card, a CURRENT
// STEP bar, and Approve/Deny inline on the canvas -- liveRunState.ts + LiveRunControls.tsx.
// Both scenarios here are fully deterministic: no clipboard, no network,
// no real external call ever actually fires (the guardrail checkpoint
// node parks unconditionally, before anything downstream of it runs).

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

// See composition.spec.ts's own copy of this helper for the full
// reasoning (Primer's TabPanel keeps every open tab mounted, toggling
// `hidden` rather than unmounting; .last() resolves to the innermost
// Canvas/Runs tabpanel once a saved workflow nests one).
function activePanel(page: import('@playwright/test').Page) {
  return page.locator('[role="tabpanel"]:not([hidden])').last()
}

// See composition.spec.ts's own copy of this helper for the full
// reasoning (Locator.dragTo() doesn't fire real HTML5 DnD events).
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

// Fits the graph, then adds one Zoom Out for clearance -- confirmed by
// direct diagnosis (a real timeout naming the exact culprit: "<toolbar
// helper text> subtree intercepts pointer events"), a 3-node vertical
// chain's default Fit View padding can leave the topmost node's handle
// underneath the canvas's docked full-width top toolbar (canvasToolbar,
// CompositionCanvas.module.css) -- the same class of collision the
// MiniMap-overlap reasoning below already documents for the *bottom*
// corner, just the top edge instead. Called once per test, before any
// connectNodes calls, rather than by connectNodes itself, since
// re-fitting between connections would undo the added clearance.
async function fitAndSpaceOut(page: import('@playwright/test').Page) {
  const panel = activePanel(page)
  await panel.getByRole('button', { name: 'Fit View' }).click()
  await page.waitForTimeout(300)
  await panel.getByRole('button', { name: 'Zoom Out' }).click()
  await page.waitForTimeout(200)
}

// Draws a real edge between two already-dropped nodes, found by the
// (distinct) label text on their card -- CanvasNodeView.tsx's Handle
// components (@xyflow/react) drive connection-dragging off native
// pointer events, unlike the palette's own HTML5 Drag-and-Drop drop
// target above, so Playwright mouse actions are the real interaction
// here, not a workaround. `.hover()`, not a raw `page.mouse.move()` to a
// `boundingBox()` snapshot -- confirmed by direct diagnosis (a
// throwaway native pointerdown/mousedown listener attached straight to
// the handle element never fired for a source computed that way):
// `.hover()` re-resolves the element's live position immediately before
// dispatching, where a coordinate captured slightly earlier can drift
// off a 12x12 handle by the time the browser actually processes it.
// Connecting off the starter Trigger node specifically (not exercised by
// any existing canvas e2e spec, which always deletes the starter first)
// is what surfaced this.
async function connectNodes(page: import('@playwright/test').Page, sourceLabel: string, targetLabel: string) {
  const panel = activePanel(page)
  const sourceHandle = panel.locator('.react-flow__node').filter({ hasText: sourceLabel }).locator('.react-flow__handle.source')
  const targetHandle = panel.locator('.react-flow__node').filter({ hasText: targetLabel }).locator('.react-flow__handle.target')
  await sourceHandle.hover()
  await page.mouse.down()
  await targetHandle.hover()
  await page.mouse.up()
}

test('Happy path: node cards reach done, the bar shows the finished run, and dismiss clears both', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()

  // The default starter (trigger-manual) stays -- connect it to a
  // dropped process-inject-text node, a pure payload-in/payload-out step
  // with no clipboard/network dependency, so the whole run is
  // deterministic.
  await dragPaletteItemToCanvas(page, 'process-inject-text')
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(2)
  await fitAndSpaceOut(page)
  await connectNodes(page, 'Trigger: manual', 'Process: Inject text')
  await expect(activePanel(page).locator('.react-flow__edge')).toHaveCount(1)

  await activePanel(page).locator('.react-flow__node').filter({ hasText: 'Process: Inject text' }).click()
  const textField = activePanel(page).locator('textarea[data-testid="canvas-config-field"]')
  await textField.fill('e2e live run state text')
  await textField.blur()

  const label = 'E2E live-run-state happy path'
  await activePanel(page).getByLabel('Label').fill(label)
  await activePanel(page).getByTestId('save-workflow').click()

  // Save closes the editor tab (app/WorkTabShell.tsx's onSaved) -- reopen
  // it via a row click (InventoryList's onOpen, docs/goals/0007) so the
  // canvas's own Run button (only rendered for an already-saved
  // workflow) is reachable.
  const row = workflowRow(page, label)
  await expect(row).toBeVisible()
  await row.click()
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(2)

  await activePanel(page).getByTestId('canvas-run').click()

  const triggerStatus = activePanel(page).locator('.react-flow__node').filter({ hasText: 'Trigger: manual' }).getByTestId('node-run-status')
  const injectStatus = activePanel(page).locator('.react-flow__node').filter({ hasText: 'Process: Inject text' }).getByTestId('node-run-status')
  await expect(injectStatus).toHaveAttribute('data-status', 'done', { timeout: 10_000 })
  await expect(triggerStatus).toHaveAttribute('data-status', 'done', { timeout: 10_000 })

  const bar = activePanel(page).getByTestId('current-step-bar')
  await expect(bar).toBeVisible()
  await expect(bar).toContainText('SUCCESS')

  await activePanel(page).getByTestId('dismiss-run-state').click()
  await expect(activePanel(page).getByTestId('current-step-bar')).toHaveCount(0)
  await expect(activePanel(page).getByTestId('node-run-status')).toHaveCount(0)

  await activePanel(page).getByRole('button', { name: 'Back to workflows' }).click()
  await clickRowAction(page, workflowRow(page, label), 'Delete')
  await expect(workflowRow(page, label)).toHaveCount(0)
})

test('Park then deny: the checkpoint node shows awaiting-approval, the bar offers inline Approve/Deny, and deny fails the run', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()

  // human-review (docs/adr/0022's Update + docs/adr/0023) always parks,
  // regardless of any guardrail allow rule -- a deterministic checkpoint
  // that never lets process-inject-text after it actually run.
  await dragPaletteItemToCanvas(page, 'human-review')
  await dragPaletteItemToCanvas(page, 'process-inject-text')
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(3)
  await fitAndSpaceOut(page)
  await connectNodes(page, 'Trigger: manual', 'Human review')
  await connectNodes(page, 'Human review', 'Process: Inject text')
  await expect(activePanel(page).locator('.react-flow__edge')).toHaveCount(2)

  const label = 'E2E live-run-state park-deny'
  await activePanel(page).getByLabel('Label').fill(label)
  await activePanel(page).getByTestId('save-workflow').click()

  const row = workflowRow(page, label)
  await expect(row).toBeVisible()
  await row.click()
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(3)

  await activePanel(page).getByTestId('canvas-run').click()

  const reviewStatus = activePanel(page).locator('.react-flow__node').filter({ hasText: 'Human review' }).getByTestId('node-run-status')
  await expect(reviewStatus).toHaveAttribute('data-status', 'awaiting-approval', { timeout: 10_000 })

  const bar = activePanel(page).getByTestId('current-step-bar')
  await expect(bar).toContainText('Awaiting approval')
  await expect(activePanel(page).getByTestId('canvas-deny-step')).toBeVisible()

  await activePanel(page).getByTestId('canvas-deny-step').click()

  // A deny fails the run closed -- the bar shows the finished (error)
  // outcome, and the checkpoint's own card carries a danger status.
  // Which exact status string ("failed" vs "denied") the run/step ends
  // up with is an implementation detail of how a denied human-review
  // checkpoint differs from a denied ambient guardrail rule (only the
  // latter is decoded as "denied" -- executionservice.go's GetRun), so
  // this asserts either, not a single hardcoded string.
  await expect(bar).toContainText(/ERROR|MAX_RECOVERY_ATTEMPTS_EXCEEDED/, { timeout: 10_000 })
  await expect(reviewStatus).toHaveAttribute('data-status', /failed|denied/, { timeout: 10_000 })

  await activePanel(page).getByTestId('dismiss-run-state').click()
  await activePanel(page).getByRole('button', { name: 'Back to workflows' }).click()
  await clickRowAction(page, workflowRow(page, label), 'Delete')
  await expect(workflowRow(page, label)).toHaveCount(0)
})
