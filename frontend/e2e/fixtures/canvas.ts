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

// Raw pointer drag between two handle locators (mousedown -> intermediate
// moves -> mouseup) -- CanvasNodeView.tsx's Handle components
// (@xyflow/react) drive connection-dragging off native mouse events, not
// native HTML5 Drag-and-Drop, so this is the real interaction, not a
// workaround. The START point is actionability-checked via
// `sourceHandle.hover()` immediately before mouse.down() -- a 12x12
// handle drifts off an earlier-captured boundingBox() by the time the
// browser actually processes a raw coordinate, where hover() re-resolves
// the element's live position right before dispatching (goal 0184
// RESEARCH VERDICT). The END check is opt-in (`checkEnd`), NOT the
// default, and only safe with `steps: 0` (a direct jump, no
// intermediate path): confirmed live -- a real multi-step drag (steps >
// 0) puts the target handle into React Flow's own live "connecting"
// visual state (the `connectingto valid connectionindicator` classes),
// which never satisfies Playwright's stability check (two consecutive
// unchanged frames) and times out. `checkEnd` exists for the callers
// that already proved the zero-step shape works (command-palette/
// live-run-state/quick-panel*.spec.ts's own former local copies); a
// real dragged path stays release-unchecked, the same documented
// boundary as dragBetween's free-form middle. Promoted once a fourth
// near-identical copy (those same files' own connectNodes/
// connectByIndex) appeared (testing.md's promotion rule) -- callers
// keep their own Fit-View/Zoom-Out sequencing local (a baked-in Fit
// View here would undo a caller's own clearance step) and delegate
// just the raw mechanics to this one primitive.
export async function dragBetweenHandles(page: Page, sourceHandle: Locator, targetHandle: Locator, steps = 10, checkEnd = false): Promise<void> {
  await sourceHandle.hover()
  await page.mouse.down()
  const sourceBox = await sourceHandle.boundingBox()
  const targetBox = await targetHandle.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('dragBetweenHandles: handle bounding box not found')
  const source = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 }
  const target = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 }
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(source.x + ((target.x - source.x) * i) / steps, source.y + ((target.y - source.y) * i) / steps)
  }
  if (checkEnd) {
    await targetHandle.hover()
  } else {
    await page.mouse.move(target.x, target.y)
  }
  await page.mouse.up()
}

// Draws a real edge between two already-dropped nodes, found by the
// (distinct) label text on their card. Fit View first is load-bearing,
// not cosmetic: a spiral-placed node's handle can land directly under
// the MiniMap's fixed bottom-right overlay, and waitForViewportStable
// lets its pan/zoom transition settle before bounding boxes are read --
// the interaction-race class goal 0080's register tracked across this
// exact preamble in a dozen spec files.
export async function connectNodes(page: Page, sourceLabel: string, targetLabel: string): Promise<void> {
  const panel = activePanel(page)
  await panel.getByRole('button', { name: 'Fit View' }).click()
  await waitForViewportStable(panel)
  const sourceHandle = panel.locator('.react-flow__node').filter({ hasText: sourceLabel }).locator('.react-flow__handle.source')
  const targetHandle = panel.locator('.react-flow__node').filter({ hasText: targetLabel }).locator('.react-flow__handle.target')
  await dragBetweenHandles(page, sourceHandle, targetHandle)
}

// Drags `node` by a fixed pixel delta from a given start position within
// its own box (its center, by default) -- the shape every reposition-
// via-drag test in this suite shares (a workflow-canvas node, an Atlas
// frame/note/card). The START point is actionability-checked via
// `node.hover({position})` immediately before mouse.down(), same
// contract as dragBetweenHandles/dragBetween above; the release is a free
// canvas point with no owning element, so it stays an unchecked raw
// mouse.up() (goal 0184 RESEARCH VERDICT's documented boundary).
export async function dragNodeBy(page: Page, node: Locator, dx: number, dy: number, opts: { position?: { x: number; y: number }; steps?: number } = {}): Promise<void> {
  const box = await node.boundingBox()
  if (!box) throw new Error('dragNodeBy: node has no bounding box')
  const position = opts.position ?? { x: box.width / 2, y: box.height / 2 }
  const steps = opts.steps ?? 10
  await node.hover({ position })
  await page.mouse.down()
  const start = { x: box.x + position.x, y: box.y + position.y }
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(start.x + (dx * i) / steps, start.y + (dy * i) / steps)
  }
  await page.mouse.up()
}

// Pans the whole canvas by a fixed pixel delta from a point on its own
// empty background (its center, by default) -- the real-user gesture
// that moves the graph itself, as opposed to dragNodeBy's single-node
// drag. Needed when a node's fixed graph position lands under React
// Flow's own fixed-position MiniMap/Controls chrome at the canvas's
// default pan/zoom (confirmed directly by Playwright's own
// actionability check naming the MiniMap's subtree, not assumed) --
// zooming out alone re-centers on the CURRENT view instead of moving
// content away from that corner, so it doesn't reliably clear the
// same overlap a plain retry loop keeps re-measuring. The START point
// is actionability-checked via `pane.hover({position})` immediately
// before mouse.down(), same contract as dragNodeBy/dragBetweenHandles
// above.
export async function panCanvasBy(page: Page, panel: Locator, dx: number, dy: number, opts: { position?: { x: number; y: number }; steps?: number } = {}): Promise<void> {
  const pane = panel.locator('.react-flow__pane')
  const box = await pane.boundingBox()
  if (!box) throw new Error('panCanvasBy: canvas pane has no bounding box')
  const position = opts.position ?? { x: box.width / 2, y: box.height / 2 }
  const steps = opts.steps ?? 10
  await pane.hover({ position })
  await page.mouse.down()
  const start = { x: box.x + position.x, y: box.y + position.y }
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(start.x + (dx * i) / steps, start.y + (dy * i) / steps)
  }
  await page.mouse.up()
}
