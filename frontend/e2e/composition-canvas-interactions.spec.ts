import { test, expect } from './fixtures/server'
import { withClipboardLock } from './fixtures/clipboardLock'
import { clickRowAction } from './inventoryRow'

// Canvas-mechanics edge cases for the same React Flow canvas
// composition.spec.ts's header comment describes (SPEC.md §3/ADR-0005) --
// drop collisions, node-type swap, the declared-Attributes test-input
// dialog, and process-inject-text's multi-node composition -- split out
// once composition.spec.ts crossed the 500-line limit (CLAUDE.md).

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

// See composition.spec.ts's own copy of this helper for the full
// reasoning (Primer's TabPanel keeps every open tab mounted, toggling
// `hidden` rather than unmounting).
// .last(), not a bare match: a saved workflow's editor tab now nests a
// second Canvas/Runs tab bar inside the outer per-workflow tab
// (docs/SPEC.md §7's Update), so up to two [role="tabpanel"]:not([hidden])
// elements can be visible at once (the outer workflow tab, the inner
// Canvas/Runs one) -- document order always puts the outer one first,
// so .last() reliably resolves to the innermost, most specific panel
// regardless of whether a workflow has an inner tab bar or not.
function activePanel(page: import('@playwright/test').Page) {
  return page.locator('[role="tabpanel"]:not([hidden])').last()
}

// See composition.spec.ts's own copy of this helper for the full
// reasoning (Locator.dragTo() doesn't fire real HTML5 DnD events, so the
// palette's onDragStart/onDrop handlers need manually-dispatched
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

// Draws a real edge between two already-dropped nodes, found by the
// (distinct) label text on their card -- CanvasNodeView.tsx's Handle
// components (@xyflow/react) drive connection-dragging off native mouse
// events, unlike the palette's own HTML5 Drag-and-Drop drop target
// above, so Playwright's ordinary synthetic mouse sequence (down/move/up)
// is the real interaction here, not a workaround. "Fit View" first is
// load-bearing, not cosmetic: findFreeDropPosition's spiral can land a
// node's handle directly under the MiniMap's fixed bottom-right overlay
// (confirmed directly via document.elementFromPoint at the computed
// handle center -- it resolved to the MiniMap's own SVG rect, not the
// handle div, so the mousedown never reached React Flow's connection
// logic at all), and the brief wait lets its pan/zoom transition settle
// before bounding boxes are read.
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

// Selects a canvas node by clicking a point PROVEN to land inside its
// own card, not a fixed offset -- React Flow's own Controls (bottom-
// left: zoom/lock/Fit View) and MiniMap (bottom-right) are real, drawn
// UI chrome that Fit View's own layout can place any node underneath
// depending on node count/viewport (confirmed directly: the exact same
// top-left-corner offset that worked for a two-node graph lands on the
// Controls panel's own IconButton once a third node shifts the layout,
// silently selecting nothing -- neither a plain `.click()` (targets
// the center) nor `.click({ force: true })` (skips Playwright's
// actionability check, not the browser's real hit-testing) catches
// this). Tries a few candidate points around the card, verifying via
// document.elementFromPoint that each one actually resolves inside
// THIS node's own `.react-flow__node` wrapper (a per-node badge is a
// valid hit too -- it's still a descendant, clicks on it still select
// the node) before clicking there for real.
async function clickCanvasNode(page: import('@playwright/test').Page, panel: import('@playwright/test').Locator, label: string) {
  const node = panel.locator('.react-flow__node').filter({ hasText: label })
  const box = await node.boundingBox()
  if (!box) throw new Error(`clickCanvasNode: node "${label}" has no bounding box`)
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
    if (insideNode) {
      await page.mouse.click(point.x, point.y)
      return
    }
  }
  throw new Error(`clickCanvasNode: no point for node "${label}" resolved inside its own card -- covered by other canvas chrome at every candidate`)
}

// process-inject-text (SPEC.md §3.3) needs no bespoke Inspector UI of its
// own -- its "text" (FieldText) and "placement" (FieldOptions) fields
// render through the exact same generic ConfigField switch every other
// node type already goes through (NodeInspector.tsx). This test proves
// that end-to-end, real Go backend included, and proves the text actually
// lands in the *correct position* relative to an upstream node's own
// output -- Go-level ordering is already covered by
// TestExecuteWorkflow_InjectText_PrependIsAppliedBeforeExistingPayload;
// this is the UI path that composes it, not a re-proof of the ordering
// logic itself.
// Real OS clipboard I/O (goal 0009) -- writes apply-clipboard-write-html.
test('process-inject-text composes with an upstream node via the generic Inspector, in the correct position', async ({ page }) => {
  await withClipboardLock(async () => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  // Keeps the starter trigger-manual node -- docs/adr/0028 requires a
  // Trigger root, so Apply-then-Process alone can no longer be the
  // whole graph on its own.
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()

  await dragPaletteItemToCanvas(page, 'apply-clipboard-write-html')
  await dragPaletteItemToCanvas(page, 'process-inject-text')
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(3)

  await connectNodes(page, 'Trigger: manual', 'Apply: write HTML to clipboard')
  await connectNodes(page, 'Apply: write HTML to clipboard', 'Process: Inject text')
  await expect(activePanel(page).locator('.react-flow__edge')).toHaveCount(2)

  // Configure the upstream node's payload -- plain text (not real HTML)
  // so the base-payload marker is trivially substring-matchable in the
  // final result.
  await clickCanvasNode(page, activePanel(page), 'Apply: write HTML to clipboard')
  const htmlField = activePanel(page).locator('textarea[data-testid="canvas-config-field"]')
  await htmlField.fill('e2e base payload')
  await htmlField.blur()

  // Configure the inject node -- exercises both the plain-text field
  // (Textarea) and the FieldOptions field (a real Select, not a bespoke
  // control) in the same generic Inspector.
  await clickCanvasNode(page, activePanel(page), 'Process: Inject text')
  const inspector = activePanel(page).getByTestId('composition-inspector')
  await expect(inspector).toContainText('Process: Inject text')
  const textField = activePanel(page).locator('textarea[data-testid="canvas-config-field"]')
  await textField.fill('e2e injected hint')
  await textField.blur()
  const placementField = activePanel(page).locator('select[data-testid="canvas-config-field"]')
  await expect(placementField).toHaveValue('append')
  await placementField.selectOption('append')

  await activePanel(page).getByLabel('Label').fill('E2E inject-text workflow')
  await activePanel(page).getByTestId('save-workflow').click()

  const row = workflowRow(page, 'E2E inject-text workflow')
  await expect(row).toBeVisible()

  // The composed ordering survived save -- proven by reading each
  // node's persisted config back in read-only view mode (a row click,
  // docs/goals/0022), not by running the workflow and reading the
  // clipboard-written result: the upstream node here is
  // apply-clipboard-write-html, which needs a real OS clipboard
  // (osascript on macOS) and errors on every call on a headless Linux
  // CI runner (docs/SPEC.md §1.3), so a successful-run result string
  // isn't environment-independent. Go-level ordering is already
  // covered by TestExecuteWorkflow_InjectText_PrependIsAppliedBeforeExistingPayload;
  // this proves the UI composed the two nodes in the right position
  // (Trigger -> Apply -> Process, asserted above via the edge count)
  // and persisted each field correctly.
  await row.click()
  // Fit View + Zoom Out first, same reasoning as live-run-state.spec.ts's
  // own fitAndSpaceOut helper: reopening a saved 3-node graph doesn't
  // necessarily land in a viewport where every node's card is clear of
  // React Flow's own fixed-position Controls/MiniMap chrome, and Fit
  // View alone can still leave one edge-case node overlapping it.
  const panel = activePanel(page)
  await panel.getByRole('button', { name: 'Fit View' }).click()
  await page.waitForTimeout(300)
  await panel.getByRole('button', { name: 'Zoom Out' }).click()
  await page.waitForTimeout(200)
  await clickCanvasNode(page, activePanel(page), 'Apply: write HTML to clipboard')
  await expect(activePanel(page).getByTestId('canvas-config-field')).toHaveValue('e2e base payload')
  await clickCanvasNode(page, activePanel(page), 'Process: Inject text')
  await expect(activePanel(page).locator('textarea[data-testid="canvas-config-field"]')).toHaveValue('e2e injected hint')
  await expect(activePanel(page).locator('select[data-testid="canvas-config-field"]')).toHaveValue('append')
  await page.getByRole('link', { name: 'Workflows' }).click()

  // Running it still exercises the click -> Go binding -> render
  // pipeline end to end -- asserts SOME response, success or error.
  await row.getByRole('button', { name: 'Run' }).click()
  await expect(page.getByTestId('workflow-run-result').filter({ has: page.getByText('E2E inject-text workflow', { exact: true }) })).toBeVisible()

  await clickRowAction(page, row, 'Delete')
  await expect(workflowRow(page, 'E2E inject-text workflow')).toHaveCount(0)
  })
})

// The four tests below permanently cover bugs from a real bug report
// (docs/SPEC.md §3) that were originally verified live via throwaway
// scripts and then discarded -- .claude/rules/testing.md's whole point
// is that a manual reproduction becomes a committed test before the fix
// counts as done, so the same class of regression can't silently
// reappear.

test('Dropping a second Trigger node is silently rejected, not added as a duplicate', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()

  // The starter node is already a Trigger -- dropping trigger-hotkey
  // (a different Trigger NodeType, not a re-drop of the same one) must
  // not increase the node count. onCanvasDrop's own client-side check
  // is what this exercises; the palette's disabled styling is a
  // separate, already-covered layer (the visibility test below).
  await dragPaletteItemToCanvas(page, 'trigger-hotkey')
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(1)
})

test('A node dropped onto an occupied spot lands clear of it, not stacked', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()

  // Drops at the exact center of the canvas, which is also where the
  // starter node sits (both onCanvasDrop's screenToFlowPosition and the
  // starter's own placement resolve to roughly the same point on a
  // freshly fitView'd canvas) -- the real repro shape from the bug
  // report, not a contrived one.
  await dragPaletteItemToCanvas(page, 'process-html-to-markdown')
  const nodes = activePanel(page).locator('.react-flow__node')
  await expect(nodes).toHaveCount(2)

  const [boxA, boxB] = await Promise.all([nodes.nth(0).boundingBox(), nodes.nth(1).boundingBox()])
  if (!boxA || !boxB) throw new Error('expected both node bounding boxes to be measurable')
  const overlaps =
    boxA.x < boxB.x + boxB.width && boxA.x + boxA.width > boxB.x && boxA.y < boxB.y + boxB.height && boxA.y + boxA.height > boxB.y
  expect(overlaps).toBe(false)
})

test('A canvas node card never clips its own handles/badges (no card-level overflow:hidden)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()

  // Real, live-reproduced visual bug: .canvasNode carried overflow:hidden
  // (from the uniform-card restyle), which shaved the React Flow Handles
  // rendered inside it to half-moon slivers at the card edges -- and
  // silently also clipped the guardrail badge's -6px and the run-status
  // tag's -8px offsets. The checkable property is the computed overflow
  // itself: the card must not clip (its text lines each carry their own
  // ellipsis, so nothing needs a card-level clip).
  const card = activePanel(page).locator('[class*="canvasNode"][data-run-status], [class*="canvasNode"]').first()
  await expect(card).toBeVisible()
  await expect(card).toHaveCSS('overflow', 'visible')
})

test('A disabled Trigger palette entry never picks up the enabled hover background', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()

  // The starter node already makes every Trigger entry disabled.
  // Confirmed as the real bug shape: aria-disabled alone doesn't stop
  // the browser from hovering the element, so TreeView's own internal
  // container kept applying its normal :hover background regardless --
  // fixed via a --control-transparent-bgColor-hover token override,
  // not pointer-events: none (docs/SPEC.md §9.1 has the full reasoning
  // for why that first fix was wrong).
  const disabledItem = activePanel(page).locator('[data-node-type-id="trigger-hotkey"]')
  await disabledItem.hover()
  const container = disabledItem.locator('[class*="TreeViewItemContainer"]')
  await expect(container).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
})

test('Selecting the starter Trigger node and changing its type swaps it in place', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()

  const nodes = activePanel(page).locator('.react-flow__node')
  await nodes.first().click()
  await activePanel(page).getByTestId('change-node-type').selectOption('trigger-hotkey')

  // Same node, not a second one -- the whole point of swapping in place
  // instead of the old delete-and-redrag dead end.
  await expect(nodes).toHaveCount(1)
  await expect(nodes.first()).toContainText('Trigger: hotkey')
  // The trigger-hotkey-specific Inspector branch should already be live
  // immediately after the swap, not require a re-select.
  await expect(activePanel(page).getByText('Save this workflow before assigning a hotkey.')).toBeVisible()
})

// docs/adr/0008's test-input form: a workflow with declared Attributes
// prompts an auto-filled, editable form before Run instead of running
// blind with every Attribute at its zero value. No separate cleanup for
// the Attribute itself -- it's part of the workflow's own definition,
// so deleting the workflow at the end (same discipline as this file's
// other create-then-delete tests, .claude/rules/testing.md) removes it
// too.
// Real OS clipboard I/O (goal 0009) -- a brand-new workflow's default
// starter node is capture-clipboard-html (docs/SPEC.md §3), so every
// Run in this test (before and after Attributes exist) touches the
// real pasteboard.
test('Running a workflow with declared Attributes shows an auto-filled test-input dialog first', async ({ page }) => {
  await withClipboardLock(async () => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByLabel('Label').fill('E2E attributes workflow')
  await activePanel(page).getByTestId('save-workflow').click()

  const row = workflowRow(page, 'E2E attributes workflow')
  await expect(row).toBeVisible()

  // A workflow with no declared Attributes yet runs immediately, no
  // dialog -- confirms the "no UI for a decision that doesn't exist"
  // path still holds before adding one changes that.
  await row.getByRole('button', { name: 'Run' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Attributes' }).click()
  // Design wave 3: ConfigureAttributes conforms to its sibling tabs'
  // InventoryList-row pattern -- row click opens the schema editor,
  // replacing the old bare `<Select>` dropdown.
  await page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText('E2E attributes workflow', { exact: true }) }).click()
  await expect(page.getByTestId('attributes-editor')).toBeVisible()
  await page.getByRole('button', { name: 'Add attribute' }).click()
  await page.getByPlaceholder('key').fill('urgent')
  await page.getByPlaceholder('label').fill('Urgent')
  await page.getByTestId('save-attributes').click()
  await expect(page.getByText('Saved.')).toBeVisible()

  await page.getByRole('link', { name: 'Workflows' }).click()
  await workflowRow(page, 'E2E attributes workflow').getByRole('button', { name: 'Run' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Urgent')
  await expect(dialog.getByTestId('test-run-field')).toBeVisible()

  await dialog.getByRole('button', { name: 'Run' }).click()
  await expect(dialog).toHaveCount(0)

  await clickRowAction(page, workflowRow(page, 'E2E attributes workflow'), 'Delete')
  await expect(workflowRow(page, 'E2E attributes workflow')).toHaveCount(0)
  })
})
