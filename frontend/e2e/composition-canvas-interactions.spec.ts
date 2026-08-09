import { test, expect } from '@playwright/test'

// Canvas-mechanics edge cases for the same React Flow canvas
// composition.spec.ts's header comment describes (SPEC.md §3/ADR-0005) --
// drop collisions, node-type swap, the declared-Attributes test-input
// dialog, and process-inject-text's multi-node composition -- split out
// once composition.spec.ts crossed the 500-line limit (CLAUDE.md).

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="workflow-row"]', { has: page.getByText(label, { exact: true }) })
}

// See composition.spec.ts's own copy of this helper for the full
// reasoning (Primer's TabPanel keeps every open tab mounted, toggling
// `hidden` rather than unmounting).
function activePanel(page: import('@playwright/test').Page) {
  return page.locator('[role="tabpanel"]:not([hidden])')
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

// Removes the pre-populated starter node so a test can build an exact,
// known node set instead of accounting for "the starter plus whatever I
// added."
async function deleteStarterNode(page: import('@playwright/test').Page) {
  await activePanel(page).locator('.react-flow__node').click()
  await activePanel(page).getByRole('button', { name: 'Delete selected' }).click()
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(0)
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
test('process-inject-text composes with an upstream node via the generic Inspector, in the correct position', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()
  await page.getByTestId('new-workflow').click()
  await deleteStarterNode(page)
  await activePanel(page).getByTestId('toggle-palette').click()

  await dragPaletteItemToCanvas(page, 'apply-clipboard-write-html')
  await dragPaletteItemToCanvas(page, 'process-inject-text')
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(2)

  await connectNodes(page, 'Apply: write HTML to clipboard', 'Process: Inject text')
  await expect(activePanel(page).locator('.react-flow__edge')).toHaveCount(1)

  // Configure the upstream node's payload -- plain text (not real HTML)
  // so the base-payload marker is trivially substring-matchable in the
  // final result.
  await activePanel(page).locator('.react-flow__node').filter({ hasText: 'Apply: write HTML to clipboard' }).click()
  const htmlField = activePanel(page).locator('textarea[data-testid="canvas-config-field"]')
  await htmlField.fill('e2e base payload')
  await htmlField.blur()

  // Configure the inject node -- exercises both the plain-text field
  // (Textarea) and the FieldOptions field (a real Select, not a bespoke
  // control) in the same generic Inspector.
  await activePanel(page).locator('.react-flow__node').filter({ hasText: 'Process: Inject text' }).click()
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
  await row.getByRole('button', { name: 'Run' }).click()

  const result = row.locator('pre')
  await expect(result).toHaveText('e2e base payload\n\ne2e injected hint')

  await row.getByRole('button', { name: /Delete E2E inject-text workflow/ }).click()
  await expect(workflowRow(page, 'E2E inject-text workflow')).toHaveCount(0)
})

// The four tests below permanently cover bugs from a real bug report
// (docs/SPEC.md §3) that were originally verified live via throwaway
// scripts and then discarded -- .claude/rules/testing.md's whole point
// is that a manual reproduction becomes a committed test before the fix
// counts as done, so the same class of regression can't silently
// reappear.

test('Dropping a second Trigger node is silently rejected, not added as a duplicate', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()
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
  await page.getByRole('link', { name: 'Composition' }).click()
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

test('A disabled Trigger palette entry never picks up the enabled hover background', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()
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
  await page.getByRole('link', { name: 'Composition' }).click()
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
test('Running a workflow with declared Attributes shows an auto-filled test-input dialog first', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()
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
  await page.getByTestId('attributes-workflow-select').selectOption({ label: 'E2E attributes workflow' })
  await page.getByRole('button', { name: 'Add attribute' }).click()
  await page.getByPlaceholder('key').fill('urgent')
  await page.getByPlaceholder('label').fill('Urgent')
  await page.getByTestId('save-attributes').click()
  await expect(page.getByText('Saved.')).toBeVisible()

  await page.getByRole('link', { name: 'Composition' }).click()
  await workflowRow(page, 'E2E attributes workflow').getByRole('button', { name: 'Run' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Urgent')
  await expect(dialog.getByTestId('test-run-field')).toBeVisible()

  await dialog.getByRole('button', { name: 'Run' }).click()
  await expect(dialog).toHaveCount(0)

  await workflowRow(page, 'E2E attributes workflow').getByRole('button', { name: /Delete/ }).click()
  await expect(workflowRow(page, 'E2E attributes workflow')).toHaveCount(0)
})
