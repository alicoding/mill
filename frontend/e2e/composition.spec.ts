import { test, expect } from './fixtures/server'
import { withClipboardLock } from './fixtures/clipboardLock'
import { clickRowAction } from './inventoryRow'

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
//
// Covers the workflow list/lifecycle surface (browse, run, compose,
// edit, tabs). Canvas-mechanics edge cases (drop collisions, node-type
// swap, the test-input dialog, and process-inject-text's multi-node
// composition) live in composition-canvas-interactions.spec.ts, split
// out once this file crossed the 500-line limit (CLAUDE.md); workflow
// export/import coverage is composition-export-import.spec.ts, split
// out the same way earlier.

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

// The active tab's content -- Primer's TabPanel keeps every open tab
// mounted and toggles a `hidden` attribute rather than unmounting
// (that's what preserves each tab's in-progress canvas edits), so once
// more than one tab is open, un-scoped queries can match elements in
// tabs that merely aren't visible right now. Every test that opens more
// than one tab scopes through this.
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

// See composition-canvas-interactions.spec.ts's own copy of these two
// helpers for the full reasoning (Fit View first avoids the MiniMap-
// overlap hazard a spiral-placed node's handle can land under; a raw
// mouse click at a node's own top-left avoids the same hazard for
// selection). Both tests below keep the starter trigger-manual node
// now (docs/adr/0028 requires a Trigger root), connecting it to the
// dropped Apply node instead of deleting the starter first.
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

test('Composition page lists built-in workflows; node primitives live in a collapsible canvas panel, not the list', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await expect(page.getByRole('heading', { name: 'Workflows', level: 1 })).toBeVisible()

  await expect(workflowRow(page, 'Load sample HTML')).toBeVisible()
  await expect(workflowRow(page, 'Clipboard → Markdown')).toBeVisible()
  await expect(workflowRow(page, 'Load sample HTML').getByText('built-in')).toBeVisible()

  // The list itself stays a dense, read-only inventory row now
  // (docs/goals/0007-resource-inventory-redesign.md): the full step
  // chain (chips walked from Nodes/Edges) is no longer rendered inline
  // per row -- the canvas (entered via row click or New workflow) is
  // the only place composition detail shows, matching the reference
  // platform's own compact-table/canvas split (docs/SPEC.md §3.2).

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
  // Branch/Integration/List execution engines) + mcp-tool-call
  // (SPEC.md §3.6's MCP-client extension point) + child-workflow
  // (docs/adr/0010) + process-inject-text (SPEC.md §3.3) +
  // capture-attribute (the typed-input reader the seeded parent/child
  // example uses, added via ADR-0006's self-registration) +
  // human-review (the explicit human-in-the-loop checkpoint node,
  // docs/adr/0022's Update + docs/adr/0023) + ruleset (docs/adr/0023's
  // payload-validation node) + decision-outcome (the terminal Decision
  // node, docs/adr/0027) + code-execution (docs/adr/0026's code
  // execution capability, goal 0004b).
  await expect(activePanel(page).getByTestId('palette-item')).toHaveCount(21)
})

test('A new workflow starts with a starter node placed, not a blank canvas', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
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
  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
})

// A run's result renders below the InventoryList now, not inline
// inside the row itself (docs/goals/0007's dense-row anatomy has no
// room for a result preview) -- scoped by the same label match.
function runResult(page: import('@playwright/test').Page, label: string) {
  return page.getByTestId('workflow-run-result').filter({ has: page.getByText(label, { exact: true }) })
}

// Real OS clipboard I/O (goal 0009: frontend/e2e/fixtures/clipboardLock.ts) --
// the whole test body runs under the cross-process lock since it both
// writes to and reads the one shared real pasteboard.
test('Running the load-sample workflow produces a visible response, success or error', async ({ page }) => {
  await withClipboardLock(async () => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await workflowRow(page, 'Load sample HTML').getByRole('button', { name: 'Run' }).click()
  // Asserts the full click -> Go binding -> render pipeline produces
  // SOME response, without hard-coding osascript's platform-specific
  // text (the result content is clipboard-dependent).
  await expect(runResult(page, 'Load sample HTML').locator('pre')).toBeVisible()
  })
})

// Real OS clipboard I/O (goal 0009) -- same lock as above.
test('Running the clipboard-to-markdown workflow produces a visible response, success or error', async ({ page }) => {
  await withClipboardLock(async () => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await workflowRow(page, 'Clipboard → Markdown').getByRole('button', { name: 'Run' }).click()
  // The result is clipboard-dependent (real HTML converts; no HTML
  // falls back to plain text per SPEC §5; an empty clipboard errors) --
  // so this asserts the pipeline rendered SOME result, not a specific
  // outcome (updated 2026-08-10 when the §5 plain-text fallback landed;
  // "no HTML on clipboard" is no longer a guaranteed outcome).
  await expect(runResult(page, 'Clipboard → Markdown').locator('pre')).toBeVisible()
  })
})

// Real OS clipboard I/O (goal 0009) -- writes apply-clipboard-write-html.
test('Dragging a node onto the canvas configures it as it is added, then saves, runs and deletes for real', async ({ page }) => {
  await withClipboardLock(async () => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()

  // Keeps the starter trigger-manual node -- docs/adr/0028 requires a
  // Trigger root, so Apply alone can no longer be the whole graph.
  await dragPaletteItemToCanvas(page, 'apply-clipboard-write-html')
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(2)
  await connectNodes(page, 'Trigger: manual', 'Apply: write HTML to clipboard')

  // Clicking the dropped node surfaces its config fields immediately in
  // the Inspector -- composing and configuring happen together, not as
  // separate passes (docs/SPEC.md §3), just moved from inline-in-a-list-
  // row (the old form) to inline-on-select (the canvas).
  await clickCanvasNode(page, activePanel(page), 'Apply: write HTML to clipboard')
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

  // Running it writes the *configured* HTML, not the built-in default --
  // deterministic even in a headless CI runner: this node only writes to
  // the clipboard, it never reads from it. The result (below the list,
  // docs/goals/0007) shows the configured value, proving configuration
  // survived composition through to execution, not just the default.
  await row.getByRole('button', { name: 'Run' }).click()
  await expect(runResult(page, 'E2E custom workflow').getByText(/e2e configured value/)).toBeVisible()

  await clickRowAction(page, row, 'Delete')
  await expect(workflowRow(page, 'E2E custom workflow')).toHaveCount(0)
  })
})

test('Seeded example workflows are ordinary, fully editable and deletable', async ({ page }) => {
  // docs/SPEC.md §2.2's Update note: a seeded example is fully-owned,
  // editable/deletable data from the moment it exists (the same pattern
  // Zapier/n8n use for their own templates), not a protected specimen --
  // BuiltIn only drives the informational "built-in" badge now. Doesn't
  // actually delete "Load sample HTML" here: other specs in this shared-
  // fixture file depend on it still existing.
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  const row = workflowRow(page, 'Load sample HTML')
  await expect(row.getByText('built-in')).toBeVisible()
  // Editable: row click opens the editor (InventoryList's onOpen,
  // docs/goals/0007) -- no separate "Edit" button/menu item for
  // Workflows, since that WOULD be the same action twice.
  await row.click()
  await expect(page.getByTestId('save-workflow')).toBeVisible()
  await page.getByRole('tab', { name: 'Workflows' }).click()
  // Deletable: the row's trailing ⋯ menu offers Delete.
  await row.getByTestId('inventory-row-menu').click()
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
  await page.keyboard.press('Escape')
})

// Real OS clipboard I/O (goal 0009) -- writes apply-clipboard-write-html.
test('Editing an existing workflow updates it in place, not as a duplicate', async ({ page }) => {
  await withClipboardLock(async () => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  // Compose and save a workflow to edit -- keeps the starter
  // trigger-manual node (docs/adr/0028 requires a Trigger root) and
  // connects it to the dropped Apply node.
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'apply-clipboard-write-html')
  await connectNodes(page, 'Trigger: manual', 'Apply: write HTML to clipboard')
  await activePanel(page).getByLabel('Label').fill('E2E editable workflow')
  await activePanel(page).getByTestId('save-workflow').click()

  const row = workflowRow(page, 'E2E editable workflow')
  await expect(row).toBeVisible()

  // Re-opening it loads the existing two nodes (not the new-workflow
  // single-starter default) and its already-configured default HTML
  // value, and Save reads "Save changes" rather than "Save workflow" --
  // confirming this is an edit, not a second composition. Row click
  // opens the editor (InventoryList's onOpen, docs/goals/0007).
  await row.click()
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(2)
  await expect(activePanel(page).getByTestId('save-workflow')).toHaveText('Save changes')
  await expect(activePanel(page).getByLabel('Label')).toHaveValue('E2E editable workflow')

  await clickCanvasNode(page, activePanel(page), 'Apply: write HTML to clipboard')
  const configField = activePanel(page).getByTestId('canvas-config-field')
  await configField.fill('<p>edited value</p>')
  await configField.blur()
  await activePanel(page).getByLabel('Label').fill('E2E editable workflow (edited)')
  await activePanel(page).getByTestId('save-workflow').click()

  // Same workflow, updated -- not a duplicate: the old label is gone,
  // and there's exactly one row for the new one. The row itself no
  // longer surfaces a node's config value (docs/goals/0007's dense-row
  // anatomy dropped the old step-chain chips), so "shows the edited
  // config" is now proven by running it and reading the edited value
  // out of the result, not by reading the row.
  await expect(workflowRow(page, 'E2E editable workflow')).toHaveCount(0)
  const updated = workflowRow(page, 'E2E editable workflow (edited)')
  await expect(updated).toHaveCount(1)
  await updated.getByRole('button', { name: 'Run' }).click()
  await expect(runResult(page, 'E2E editable workflow (edited)').getByText(/edited value/)).toBeVisible()

  await clickRowAction(page, updated, 'Delete')
  await expect(updated).toHaveCount(0)
  })
})

test('Opening New workflow twice opens two tabs; closing one returns to the list without touching the other', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

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
  await expect(page.getByRole('heading', { name: 'Workflows', level: 1 })).toBeVisible()

  // Tab A is still open, with its draft label intact.
  await page.getByRole('tab').nth(1).click()
  await expect(activePanel(page).getByLabel('Label')).toHaveValue('Tab A')
})

test('Editing the same workflow twice reuses its tab instead of opening a duplicate', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByLabel('Label').fill('E2E reused-tab workflow')
  await activePanel(page).getByTestId('save-workflow').click()

  // Scoped to the outer Workflows tablist: an already-saved workflow's
  // editor tab now nests its own Canvas/Runs tablist inside it
  // (docs/SPEC.md §7's Update), so an unscoped page-wide tab count would
  // also catch those two inner tabs.
  const outerTabs = page.getByRole('tablist', { name: 'Open work' }).getByRole('tab')

  const row = workflowRow(page, 'E2E reused-tab workflow')
  await row.click()
  await expect(outerTabs).toHaveCount(2) // Workflows + one editor tab

  // Back to the list without closing the editor tab, then open the same
  // workflow again -- must switch to the existing tab, not open a second.
  await page.getByRole('tab', { name: 'Workflows' }).click()
  await row.click()
  await expect(outerTabs).toHaveCount(2)

  await page.getByRole('tab', { name: 'Workflows' }).click()
  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
})
