import type { Locator, Page } from '@playwright/test'
import { waitForViewportStable } from './animation'

// Canonical canvas/inventory helpers (goal 0080's burn-down): promoted
// out of 39/31/16/14 per-spec copies of these same five bodies
// (workflowRow/activePanel/dragPaletteItemToCanvas/connectNodes were
// character-for-character identical or equivalent across every copy
// audited; a handful of connectNodes copies that genuinely differ in
// technique stay local to their own spec files instead of being forced
// through this one, each with a comment explaining why).

// The dense inventory-row locator every workflow-list spec scopes
// through -- matches InventoryList's own row markup
// (data-testid="inventory-row", data-entity="workflow") by its visible
// label text.
export function workflowRow(page: Page, label: string): Locator {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

// The active tab's content -- Primer's TabPanel keeps every open tab
// mounted and toggles a `hidden` attribute rather than unmounting
// (that's what preserves each tab's in-progress canvas edits), so once
// more than one tab is open, un-scoped queries can match elements in
// tabs that merely aren't visible right now. `.last()`, not a bare
// match: a saved workflow's editor tab nests a second Canvas/Runs tab
// bar inside the outer per-workflow tab, so up to two
// `[role="tabpanel"]:not([hidden])` elements can be visible at once --
// document order always puts the outer one first, so `.last()`
// reliably resolves to the innermost, most specific panel regardless
// of whether a workflow has an inner tab bar or not.
export function activePanel(page: Page): Locator {
  return page.locator('[role="tabpanel"]:not([hidden])').last()
}

// Playwright's Locator.dragTo() simulates mouse events (mousedown/move/
// up), not the browser's native HTML5 Drag and Drop API -- confirmed
// directly: it does not fire real dragstart/dragover/drop DOM events
// with a DataTransfer, so CompositionCanvas.tsx's onDragStart/onDrop
// handlers (which read event.dataTransfer) never see it. Dispatching
// the real DragEvents manually, as a real user's OS-level drag gesture
// would, is the only way to exercise this path. Selects by
// NodePalette.tsx's data-node-type-id (a NodeType.ID), not visible
// text, since the palette's display label is expected to keep changing.
export async function dragPaletteItemToCanvas(page: Page, nodeTypeID: string): Promise<void> {
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

// Draws a real edge between two already-dropped nodes, found by the
// (distinct) label text on their card -- CanvasNodeView.tsx's Handle
// components (@xyflow/react) drive connection-dragging off native mouse
// events, unlike the palette's own HTML5 Drag-and-Drop drop target
// above, so Playwright's ordinary synthetic mouse sequence (down/move/up)
// is the real interaction here, not a workaround. Fit View first is
// load-bearing, not cosmetic: a spiral-placed node's handle can land
// directly under the MiniMap's fixed bottom-right overlay, and
// waitForViewportStable lets its pan/zoom transition settle before
// bounding boxes are read -- the interaction-race class goal 0080's
// register tracked across this exact preamble in a dozen spec files.
export async function connectNodes(page: Page, sourceLabel: string, targetLabel: string): Promise<void> {
  const panel = activePanel(page)
  await panel.getByRole('button', { name: 'Fit View' }).click()
  await waitForViewportStable(panel)
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
