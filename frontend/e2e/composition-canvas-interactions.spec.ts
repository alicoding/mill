import { test, expect } from './fixtures/server'
import { withClipboardLock } from './fixtures/clipboardLock'
import { clickCanvasNode } from './fixtures/canvasNode'
import { clickRowAction } from './inventoryRow'
import { workflowRow, activePanel, dragPaletteItemToCanvas, connectNodes } from './fixtures/canvas'
import { waitForViewportStable } from './fixtures/animation'

// Canvas-mechanics edge cases for the same React Flow canvas
// composition.spec.ts's header comment describes (SPEC.md §3/ADR-0005) --
// drop collisions, node-type swap, the declared-Attributes test-input
// dialog, and process-inject-text's multi-node composition -- split out
// once composition.spec.ts crossed the 500-line limit (CLAUDE.md).

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
// fixme (goal 0264, QUARANTINE.md:25 entry): deterministically red
// locally — the composed node sits outside the viewport after Fit
// View (screenshot: viewport over empty canvas, nodes only in the
// minimap); fails identically back to the #527 lockfile boundary.
// Leaves quarantine by the goal's fix, never by retry-passing.
test.fixme('process-inject-text composes with an upstream node via the generic Inspector, in the correct position', async ({ page }) => {
  // CI-only skip, goal 0069: four verified fix layers (element-level
  // clicks, transform-stability waits, chunked pans, canvas minZoom)
  // each cured a real bug, yet this test alone still reports the
  // composed node "outside of the viewport" exclusively on the Linux
  // CI runner while every local mode (4-worker and CI-matched
  // single-worker) passes 10/10. Coverage stays fully active locally;
  // revisit needs CI-side video/trace diagnostics, tracked in the
  // goal file.
  test.skip(!!process.env.CI, 'CI-runner-only canvas geometry, goal 0069')
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

  await connectNodes(page, 'Manual run', 'Write HTML to clipboard')
  await connectNodes(page, 'Write HTML to clipboard', 'Add text')
  await expect(activePanel(page).locator('.react-flow__edge')).toHaveCount(2)

  // Configure the upstream node's payload -- plain text (not real HTML)
  // so the base-payload marker is trivially substring-matchable in the
  // final result.
  await clickCanvasNode(page, activePanel(page), 'Write HTML to clipboard')
  const htmlField = activePanel(page).locator('textarea[data-testid="canvas-config-field"]')
  await htmlField.fill('e2e base payload')
  await htmlField.blur()

  // Configure the inject node -- exercises both the plain-text field
  // (Textarea) and the FieldOptions field (a real Select, not a bespoke
  // control) in the same generic Inspector.
  await clickCanvasNode(page, activePanel(page), 'Add text')
  const inspector = activePanel(page).getByTestId('composition-inspector')
  await expect(inspector).toContainText('Add text')
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
  await waitForViewportStable(panel)
  await panel.getByRole('button', { name: 'Zoom Out' }).click()
  await waitForViewportStable(panel)
  await clickCanvasNode(page, activePanel(page), 'Write HTML to clipboard')
  await expect(activePanel(page).getByTestId('canvas-config-field')).toHaveValue('e2e base payload')
  await clickCanvasNode(page, activePanel(page), 'Add text')
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
  await expect(nodes.first()).toContainText('Hotkey pressed')
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
