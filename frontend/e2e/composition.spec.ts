import { test, expect } from '@playwright/test'

// Real Go bindings over HTTP (Wails3 server mode), not mocks -- same
// setup/limitations as runbook.spec.ts (see its header comment):
// clipboard-dependent success content isn't assertable on a headless CI
// runner, so only the environment-independent path is checked here.
// Exercises SPEC.md §3 / ADR-0005's React Flow canvas (CompositionCanvas.tsx,
// built ahead of ADR-0005 B2's original deferral trigger) inside its own
// tab per open workflow (CompositionView.tsx's Tabs, matching the
// reference platform's own tabbed Workflows-list/canvas-editor split --
// see SPEC.md §3's Update bullets), each with a collapsible "Add steps"
// palette and a pre-populated starter node instead of a blank canvas.

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="workflow-row"]', { has: page.getByText(label, { exact: true }) })
}

// The active tab's content -- Primer's TabPanel keeps every open tab
// mounted and toggles a `hidden` attribute rather than unmounting
// (that's what preserves each tab's in-progress canvas edits), so once
// more than one tab is open, un-scoped queries can match elements in
// tabs that merely aren't visible right now. Every test that opens more
// than one tab scopes through this.
function activePanel(page: import('@playwright/test').Page) {
  return page.locator('[role="tabpanel"]:not([hidden])')
}

// Playwright's Locator.dragTo() simulates mouse events (mousedown/move/
// up), not the browser's native HTML5 Drag and Drop API -- confirmed
// directly, not assumed: it does not fire real dragstart/dragover/drop
// DOM events with a DataTransfer, so CompositionCanvas.tsx's
// onDragStart/onDrop handlers (which read event.dataTransfer) never see
// it. Dispatching the real DragEvents manually, as a real user's OS-
// level drag gesture would, is the only way to exercise this path.
// Scoped to the active (visible) tabpanel, same reasoning as
// activePanel() above -- palette items exist in the DOM for every open
// tab, not just the visible one.
//
// Selects by NodePalette.tsx's data-node-type-id (a NodeType.ID, e.g.
// "apply-clipboard-write-html"), not visible text -- the palette
// intentionally shows a shortened label now that TreeView groups by Kind
// (docs/SPEC.md §3), so matching on display text would be coupled to
// wording that's expected to keep changing.
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
// added." Selecting a lone node and using the toolbar's own Delete
// control, not a shortcut -- exercises the real interaction.
async function deleteStarterNode(page: import('@playwright/test').Page) {
  await activePanel(page).locator('.react-flow__node').click()
  await activePanel(page).getByRole('button', { name: 'Delete selected' }).click()
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(0)
}

test('Composition page lists built-in workflows; node primitives live in a collapsible canvas panel, not the list', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()
  await expect(page.getByRole('heading', { name: 'Capability composition' })).toBeVisible()

  await expect(workflowRow(page, 'Load sample HTML')).toBeVisible()
  await expect(workflowRow(page, 'Clipboard → Markdown')).toBeVisible()
  await expect(workflowRow(page, 'Load sample HTML').getByText('built-in')).toBeVisible()

  // The workflow's step chain still renders as chips (walked from
  // Nodes/Edges in execution order, not a flat Steps array) -- the list
  // stays read-only, the canvas (entered via New workflow or Edit) is
  // the only authoring surface, matching the reference platform's own
  // Workflows-list/canvas split (docs/SPEC.md §3.2).
  await expect(workflowRow(page, 'Clipboard → Markdown').getByText('Capture: clipboard HTML')).toBeVisible()
  // Configuration is visible as part of composition, not hidden: the
  // built-in's configured HTML value shows inline on its step chip.
  await expect(workflowRow(page, 'Load sample HTML').getByText(/html:/i)).toBeVisible()

  // Node primitives (the drag palette) only appear once you're on the
  // canvas, and even then only once toggled open ("Add steps") -- not
  // an always-visible list, and never on the Workflows page itself.
  await expect(page.getByTestId('palette-item')).toHaveCount(0)
  await page.getByTestId('new-workflow').click()
  await expect(activePanel(page).getByTestId('palette-item')).toHaveCount(0)
  await activePanel(page).getByTestId('toggle-palette').click()
  // 5 Trigger node types (SPEC.md §3.4) + trigger-callable
  // (docs/adr/0010) + the original 4 capture/process/apply node types +
  // decision-route, integration-http, list-lookup (SPEC.md §3.5's
  // Decision/Integration/List execution engines) + mcp-tool-call
  // (SPEC.md §3.6's MCP-client extension point) + child-workflow
  // (docs/adr/0010).
  await expect(activePanel(page).getByTestId('palette-item')).toHaveCount(15)
})

test('A new workflow starts with a starter node placed, not a blank canvas', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()
  await page.getByTestId('new-workflow').click()

  // Every workflow needs exactly one root, and it's now a real Trigger
  // node (SPEC.md §3.4) -- trigger-manual specifically, since it's the
  // one trigger type that needs no external config the user hasn't
  // supplied yet (hotkey/schedule/watch all do).
  const nodes = activePanel(page).locator('.react-flow__node')
  await expect(nodes).toHaveCount(1)
  await expect(nodes.first()).toContainText('Trigger: manual')

  // It's already a valid, savable one-node workflow as-is -- zero edges
  // is correct for exactly one node (both linearOrder in Go and the
  // canvas's own zod schema require len(Edges) === len(Nodes)-1).
  await activePanel(page).getByLabel('Label').fill('E2E starter-only workflow')
  await activePanel(page).getByTestId('save-workflow').click()

  const row = workflowRow(page, 'E2E starter-only workflow')
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: /Delete/ }).click()
  await expect(row).toHaveCount(0)
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
  await page.getByTestId('new-workflow').click()
  await deleteStarterNode(page)
  await activePanel(page).getByTestId('toggle-palette').click()

  await dragPaletteItemToCanvas(page, 'apply-clipboard-write-html')
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(1)

  // Clicking the dropped node surfaces its config fields immediately in
  // the Inspector -- composing and configuring happen together, not as
  // separate passes (docs/SPEC.md §3), just moved from inline-in-a-list-
  // row (the old form) to inline-on-select (the canvas).
  await activePanel(page).locator('.react-flow__node').click()
  const inspector = activePanel(page).getByTestId('composition-inspector')
  await expect(inspector).toContainText('Apply: write HTML to clipboard')

  const customHTML = '<p>e2e configured value</p>'
  const configField = activePanel(page).getByTestId('canvas-config-field')
  await configField.fill(customHTML)
  await configField.blur()

  await activePanel(page).getByLabel('Label').fill('E2E custom workflow')
  // Description is collapsed by default now (canvas-first layout,
  // docs/SPEC.md §3) -- has to be expanded before it's fillable.
  await activePanel(page).getByTestId('toggle-description').click()
  await activePanel(page).getByLabel('Description').fill('Composed by an e2e test')
  await activePanel(page).getByTestId('save-workflow').click()

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

test('Seeded example workflows are ordinary, fully editable and deletable', async ({ page }) => {
  // docs/SPEC.md §2.2's Update note: a seeded example is fully-owned,
  // editable/deletable data from the moment it exists (the same pattern
  // Zapier/n8n use for their own templates), not a protected specimen --
  // BuiltIn only drives the informational "built-in" badge now. Doesn't
  // actually delete "Load sample HTML" here: other specs in this shared-
  // fixture file depend on it still existing.
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()
  const row = workflowRow(page, 'Load sample HTML')
  await expect(row.getByText('built-in')).toBeVisible()
  await expect(row.getByRole('button', { name: /Edit/ })).toBeVisible()
  await expect(row.getByRole('button', { name: /Delete/ })).toBeVisible()
})

test('Editing an existing workflow updates it in place, not as a duplicate', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()

  // Compose and save a workflow to edit.
  await page.getByTestId('new-workflow').click()
  await deleteStarterNode(page)
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'apply-clipboard-write-html')
  await activePanel(page).getByLabel('Label').fill('E2E editable workflow')
  await activePanel(page).getByTestId('save-workflow').click()

  const row = workflowRow(page, 'E2E editable workflow')
  await expect(row).toBeVisible()

  // Re-opening it loads the existing node (not the new-workflow starter)
  // and its already-configured default HTML value, and Save reads "Save
  // changes" rather than "Save workflow" -- confirming this is an edit,
  // not a second composition.
  await row.getByRole('button', { name: /Edit E2E editable workflow/ }).click()
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(1)
  await expect(activePanel(page).getByTestId('save-workflow')).toHaveText('Save changes')
  await expect(activePanel(page).getByLabel('Label')).toHaveValue('E2E editable workflow')

  await activePanel(page).locator('.react-flow__node').click()
  const configField = activePanel(page).getByTestId('canvas-config-field')
  await configField.fill('<p>edited value</p>')
  await configField.blur()
  await activePanel(page).getByLabel('Label').fill('E2E editable workflow (edited)')
  await activePanel(page).getByTestId('save-workflow').click()

  // Same workflow, updated -- not a duplicate: the old label is gone,
  // the new one shows the edited config, and there's exactly one row
  // for it.
  await expect(workflowRow(page, 'E2E editable workflow')).toHaveCount(0)
  const updated = workflowRow(page, 'E2E editable workflow (edited)')
  await expect(updated).toHaveCount(1)
  await expect(updated.getByText(/edited value/)).toBeVisible()

  await updated.getByRole('button', { name: /Delete/ }).click()
  await expect(updated).toHaveCount(0)
})

test('Opening New workflow twice opens two tabs; closing one returns to the list without touching the other', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()

  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByLabel('Label').fill('Tab A')
  // Switch away without closing -- the tab, and its draft label, must
  // survive: Primer's TabPanel keeps inactive panels mounted (a hidden
  // attribute, not an unmount), which is what this whole feature relies
  // on for state preservation across tabs.
  await page.getByRole('tab', { name: 'Workflows' }).click()

  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByLabel('Label').fill('Tab B')

  await expect(page.getByRole('tab')).toHaveCount(3) // Workflows + two New workflow tabs

  // Closing the active tab (Tab B) falls back to the Workflows list.
  await page.getByRole('button', { name: 'Close tab' }).last().click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.getByRole('heading', { name: 'Capability composition' })).toBeVisible()

  // Tab A is still open, with its draft label intact.
  await page.getByRole('tab').nth(1).click()
  await expect(activePanel(page).getByLabel('Label')).toHaveValue('Tab A')
})

test('Editing the same workflow twice reuses its tab instead of opening a duplicate', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()

  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByLabel('Label').fill('E2E reused-tab workflow')
  await activePanel(page).getByTestId('save-workflow').click()

  const row = workflowRow(page, 'E2E reused-tab workflow')
  await row.getByRole('button', { name: /Edit/ }).click()
  await expect(page.getByRole('tab')).toHaveCount(2) // Workflows + one editor tab

  // Back to the list without closing the editor tab, then Edit the same
  // workflow again -- must switch to the existing tab, not open a second.
  await page.getByRole('tab', { name: 'Workflows' }).click()
  await row.getByRole('button', { name: /Edit/ }).click()
  await expect(page.getByRole('tab')).toHaveCount(2)

  await page.getByRole('tab', { name: 'Workflows' }).click()
  await row.getByRole('button', { name: /Delete/ }).click()
  await expect(row).toHaveCount(0)
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
