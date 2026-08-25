import { test, expect } from './fixtures/server'
import { activePanel, connectNodes, dragNodeBy, dragPaletteItemToCanvas } from './fixtures/canvas'
import { clickCanvasNode } from './fixtures/canvasNode'
import { waitForViewportStable } from './fixtures/animation'

// The Branch node's Rules panel (docs/goals/0173): an ordered rule list
// authored inside the node's own inspector, each rule still backed by a
// real canvas edge. Assertions are scoped entirely to a workflow this
// spec creates and never saves -- no shared-pool state, per
// .claude/rules/testing.md's declare-it-up-front rule.

// Drags a Rules-panel row's grabber handle onto another row to reorder
// them. Mirrors fixtures/canvas.ts's own dragPaletteItemToCanvas: the
// row is built on native HTML5 drag-and-drop (DecisionRuleRow.tsx),
// which Playwright's own Locator.dragTo() (pointer events only) never
// fires real dragstart/dragover/drop for -- same documented gap that
// helper's header comment already explains. dragstart and dragover/drop
// are dispatched as two separate steps (not one atomic script) because
// the panel's own drag-source id lives in React state (DecisionRulesPanel's
// dragId, set by the dragstart handler) -- a real gesture always has a
// real dragover in between giving React a render tick to commit it, but
// firing all three DragEvents synchronously in one script never yields
// that tick, so onDrop would still close over the pre-drag value.
// Waiting on the dragged row's own isDragging-driven opacity (this
// component's only visible signal of that state, DecisionRulesPanel.
// module.css's .rowDragging) is the real observable condition, not a
// fixed sleep.
async function dragRuleRow(page: import('@playwright/test').Page, fromEdgeId: string, toEdgeId: string): Promise<void> {
  await page.evaluate((from) => {
    const handle = document.querySelector(`[data-testid="decision-rule-row"][data-edge-id="${from}"] [data-testid="decision-rule-drag-handle"]`)
    if (!handle) throw new Error(`dragRuleRow: no handle for ${from}`)
    const dataTransfer = new DataTransfer()
    ;(window as unknown as { __e2eDragDataTransfer: DataTransfer }).__e2eDragDataTransfer = dataTransfer
    handle.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
  }, fromEdgeId)

  const fromRow = page.locator(`[data-testid="decision-rule-row"][data-edge-id="${fromEdgeId}"]`)
  await expect(fromRow).toHaveCSS('opacity', '0.5')

  await page.evaluate((to) => {
    const target = document.querySelector(`[data-testid="decision-rule-row"][data-edge-id="${to}"]`)
    if (!target) throw new Error(`dragRuleRow: no target row for ${to}`)
    const dataTransfer = (window as unknown as { __e2eDragDataTransfer: DataTransfer }).__e2eDragDataTransfer
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
  }, toEdgeId)
}

test('Add rule arms a pending stub that a direct draw fills, and the row edits inline', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()

  await dragPaletteItemToCanvas(page, 'decision-route')
  await dragPaletteItemToCanvas(page, 'apply-clipboard-write-html')
  await dragPaletteItemToCanvas(page, 'apply-notify')

  await clickCanvasNode(page, activePanel(page), 'Branch')
  const panel = activePanel(page).getByTestId('decision-rules-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('decision-rules-empty')).toBeVisible()

  // "Add rule" queues a stub -- no row yet, since nothing is wired.
  await panel.getByTestId('decision-add-rule').click()
  await expect(panel.getByTestId('decision-rule-pending')).toBeVisible()
  await expect(panel.getByTestId('decision-rules-empty')).toHaveCount(0)

  // Drawing the connection fills the queued stub: one real rule row,
  // still no otherwise assigned to it.
  await connectNodes(page, 'Branch', 'Write HTML to clipboard')
  await expect(panel.getByTestId('decision-rule-pending')).toHaveCount(0)
  const rows = panel.getByTestId('decision-rule-row')
  await expect(rows).toHaveCount(1)
  await expect(activePanel(page).locator('.react-flow__edge')).toHaveCount(1)

  // A direct draw (no Add rule first) with no otherwise yet claims the
  // pinned fallback slot automatically.
  await connectNodes(page, 'Branch', 'Notify me')
  await expect(rows).toHaveCount(1)
  await expect(activePanel(page).getByTestId('decision-otherwise-row').getByTestId('decision-otherwise-unconnected')).toHaveCount(0)
  await expect(activePanel(page).locator('.react-flow__edge')).toHaveCount(2)

  // The row's own label field edits the visible canvas edge label,
  // never the condition.
  await rows.first().getByTestId('decision-rule-label').fill('High priority')
  const ruleEdgeId = await rows.first().getAttribute('data-edge-id')
  await expect(activePanel(page).locator(`.react-flow__edge[data-id="${ruleEdgeId}"]`)).toContainText('High priority')
})

test('Reordering rows changes evaluation order, deleting a row removes its canvas edge, and the edge click still opens its own inspector', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()

  await dragPaletteItemToCanvas(page, 'decision-route')
  await dragPaletteItemToCanvas(page, 'apply-clipboard-write-html')
  await dragPaletteItemToCanvas(page, 'apply-notify')
  // Wires the starter Trigger into the graph -- left disconnected, its
  // card can end up sitting close enough to the Branch's own edges to
  // steal a click, since findFreeDropPosition only nudges dropped nodes
  // clear of a collision, not into a laid-out graph shape.
  await connectNodes(page, 'Manual run', 'Branch')

  await clickCanvasNode(page, activePanel(page), 'Branch')
  const panel = activePanel(page).getByTestId('decision-rules-panel')

  // Two Add-rule-queued rules, in this order: html first, notify second.
  await panel.getByTestId('decision-add-rule').click()
  await connectNodes(page, 'Branch', 'Write HTML to clipboard')
  await panel.getByTestId('decision-add-rule').click()
  await connectNodes(page, 'Branch', 'Notify me')

  const rows = panel.getByTestId('decision-rule-row')
  await expect(rows).toHaveCount(2)
  const [firstId, secondId] = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-edge-id')))
  expect(firstId).not.toBeNull()
  expect(secondId).not.toBeNull()

  // Reorder: drag the second row onto the first -- row order (and
  // therefore evaluation order, canvasStore's reorderDecisionEdges)
  // flips.
  await dragRuleRow(page, secondId!, firstId!)
  await expect(async () => {
    const order = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-edge-id')))
    expect(order).toEqual([secondId, firstId])
  }).toPass({ timeout: 5_000 })

  // Deleting the (now-first) row removes its edge from the canvas too
  // -- three total (trigger->Branch, plus the two rules) before, two
  // (trigger->Branch, plus the surviving rule) after.
  await expect(activePanel(page).locator('.react-flow__edge')).toHaveCount(3)
  const survivingId = await rows.nth(1).getAttribute('data-edge-id')
  await rows.first().getByTestId('decision-rule-delete').click()
  await expect(rows).toHaveCount(1)
  await expect(activePanel(page).locator('.react-flow__edge')).toHaveCount(2)

  // The node panel is additional, not a replacement -- clicking the
  // remaining rule's own edge directly on canvas still opens its own
  // condition. Every node here dropped near the same canvas-center
  // point (findFreeDropPosition only nudges clear of a collision, not
  // into a laid-out shape), so the Trigger card still sits close
  // enough to intercept the click -- drag it well clear first, a real
  // pointer gesture, before targeting the edge by its own known id.
  const panelAfterDelete = activePanel(page)
  await panelAfterDelete.getByRole('button', { name: 'Fit View' }).click()
  await waitForViewportStable(panelAfterDelete)
  const triggerNode = panelAfterDelete.locator('.react-flow__node').filter({ hasText: 'Manual run' })
  await dragNodeBy(page, triggerNode, -250, -250)
  await panelAfterDelete.locator(`[data-testid="rf__edge-${survivingId}"]`).click()
  await expect(panelAfterDelete.getByText('Decision branch')).toBeVisible()
})
