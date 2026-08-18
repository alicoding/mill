import { test, expect } from './fixtures/server'
import { withClipboardLock } from './fixtures/clipboardLock'
import { clickRowAction } from './inventoryRow'
import { workflowRow, activePanel, dragPaletteItemToCanvas, connectNodes } from './fixtures/canvas'
import { clickCanvasNode } from './fixtures/canvasNode'
import { waitForViewportStable } from './fixtures/animation'

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

// See live-run-state.spec.ts's own copy of this helper for the full
// reasoning: Fit View alone can still leave a node's own card
// overlapping React Flow's fixed-position Controls/MiniMap chrome
// (bottom-left/bottom-right) depending on node count and viewport, and
// Zoom Out gives clickCanvasNode more clearance from both. Used before
// re-selecting a node on an already-saved, reopened canvas (view mode),
// where -- unlike a fresh compose pass -- nothing has fitted the
// viewport yet.
async function fitAndSpaceOut(page: import('@playwright/test').Page) {
  const panel = activePanel(page)
  await panel.getByRole('button', { name: 'Fit View' }).click()
  await waitForViewportStable(panel)
  await panel.getByRole('button', { name: 'Zoom Out' }).click()
  await waitForViewportStable(panel)
}

test('Composition page lists built-in workflows; node primitives live in a collapsible canvas panel, not the list', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await expect(page.getByTestId('composition-view')).toBeVisible()

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
  // execution capability, goal 0004b) + capture-file,
  // process-extract-html, capture-clipboard-info (the save-page
  // capture floor + clipboard inspector, docs/adr/0030 / SPEC.md §5) +
  // list-search (docs/goals/0011-lists-maturation.md's richer, typed
  // successor to list-lookup) + trigger-system-event (docs/adr/0035's
  // unparked System/meta trigger) + process-ai-completion,
  // process-ai-extract-structured, process-ai-classify (the AI node
  // family, docs/goals/0031-ai-node-family.md) + apply-file-write (the
  // write inverse of capture-file, goal 0044) + process-run-receipt
  // (the evidence-receipt node, goal 0052 slice 3) + the seeded
  // "Check httpbin" declared step type (data-backed, not a
  // RegisterNodeType call site -- goal 0054 slice A, ADR-0037) +
  // trigger-atlas-card, process-atlas-card-find, apply-atlas-card-create,
  // apply-atlas-card-update, apply-atlas-card-link (the Atlas<->Workflows
  // integration, goal 0066, ADR-0035/0038) + apply-backup-snapshot
  // (goal 0065's data-stewardship backup step) + apply-list-row (the
  // Lists write path, goal 0070) + apply-file-move (file verbs, goal
  // 0087) + apply-atlas-from-reply (the clipboard bridge's accepted-
  // reply materializer, goal 0099).
  await expect(activePanel(page).getByTestId('palette-item')).toHaveCount(43)
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

// "Running the load-sample/clipboard-to-markdown workflows" and the
// "Saved-page seed" Run-dialog test moved to
// composition-seeded-runs.spec.ts once this file crossed the 500-line
// limit (CLAUDE.md) -- that file's own header comment has the seam
// this split follows (running a SEEDED workflow via the list vs.
// composing/editing one from scratch, which stays here).

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

  // The configured HTML (not the built-in default) survived save --
  // proven by reading it back off the saved node in read-only view mode
  // (a row click, docs/goals/0022), not by running the workflow and
  // reading the clipboard's own content: apply-clipboard-write-html
  // needs a real OS clipboard (osascript on macOS), which errors on
  // every call on a headless Linux CI runner (docs/SPEC.md §1.3), so a
  // successful-write result string isn't environment-independent.
  await row.click()
  await fitAndSpaceOut(page)
  await clickCanvasNode(page, activePanel(page), 'Apply: write HTML to clipboard')
  await expect(activePanel(page).getByTestId('canvas-config-field')).toHaveValue(customHTML)
  await page.getByRole('link', { name: 'Workflows' }).click()

  // Running it still exercises the click -> Go binding -> render
  // pipeline end to end -- asserts SOME response, success or error,
  // same reasoning as the built-in seeds' own run tests above.
  await row.getByRole('button', { name: 'Run' }).click()
  await expect(runResult(page, 'E2E custom workflow')).toBeVisible()

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
  // Row click opens VIEW mode now (docs/goals/0022, InventoryList's
  // onOpen) -- read-only inspection, no Save button.
  await row.click()
  await expect(page.getByTestId('save-workflow')).toHaveCount(0)
  await expect(page.getByTestId('edit-workflow')).toBeVisible()
  // Editable: the row's own trailing ⋯ menu offers an explicit Edit
  // action (the goal's own explicit-gesture grammar), which switches
  // this SAME tab into the full editor and activates it -- no separate
  // navigation back to the list needed first.
  await page.getByRole('tab', { name: 'Workflows' }).click()
  await row.getByTestId('inventory-row-menu').click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  await expect(page.getByTestId('save-workflow')).toBeVisible()
  // Back to the list for the Delete check below.
  await page.getByRole('tab', { name: 'Workflows' }).click()
  // Deletable: the same row menu offers Delete.
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
  // single-starter default), read-only at first (docs/goals/0022's row
  // click = VIEW mode) -- Edit switches this same tab into the editor,
  // where its already-configured default HTML value shows and Save
  // reads "Save changes" rather than "Save workflow," confirming this
  // is an edit, not a second composition.
  await row.click()
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(2)
  await activePanel(page).getByTestId('edit-workflow').click()
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
  // config" is proven by reopening the canvas in read-only view mode
  // (a row click, docs/goals/0022) and reading the persisted
  // ConfigField value back -- not by running the workflow and reading
  // the edited value out of the clipboard: apply-clipboard-write-html
  // needs a real OS clipboard (osascript on macOS), which errors on
  // every call on a headless Linux CI runner (docs/SPEC.md §1.3), so a
  // successful-write result string isn't environment-independent.
  await expect(workflowRow(page, 'E2E editable workflow')).toHaveCount(0)
  const updated = workflowRow(page, 'E2E editable workflow (edited)')
  await expect(updated).toHaveCount(1)

  await updated.click()
  await fitAndSpaceOut(page)
  await clickCanvasNode(page, activePanel(page), 'Apply: write HTML to clipboard')
  await expect(activePanel(page).getByTestId('canvas-config-field')).toHaveValue('<p>edited value</p>')
  await page.getByRole('link', { name: 'Workflows' }).click()

  // Running it still exercises the click -> Go binding -> render
  // pipeline end to end -- asserts SOME response, success or error.
  await updated.getByRole('button', { name: 'Run' }).click()
  await expect(runResult(page, 'E2E editable workflow (edited)')).toBeVisible()

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

  // Closing the active, dirty tab (Tab B) prompts (docs/goals/0048-
  // unsaved-close-guard.md); "Don't save" discards it and falls back
  // to the Workflows list.
  await page.getByRole('button', { name: 'Close tab' }).last().click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Don\'t save' }).click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.getByTestId('composition-view')).toBeVisible()

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

  // VS Code tab anatomy (superseding the two-line kicker, which put
  // labels at varying baselines in the titlebar band): every tab is
  // icon + single-line label. The editor tab's icon carries the
  // entity kind (the same cue inventory rows use); the page tab shows
  // its section glyph. Both aria-hidden-adjacent (icon spans carry no
  // text), so accessible tab NAMES stay the bare label -- asserted
  // implicitly by every getByRole('tab', { name }) in this suite.
  await expect(outerTabs.nth(1).locator('[data-testid="tab-icon"][data-entity="workflow"]')).toBeVisible()
  await expect(outerTabs.nth(0).getByTestId('tab-icon')).toBeVisible()
  // The kicker is retired in the band -- no two-line tabs remain.
  await expect(page.getByTestId('tab-kicker')).toHaveCount(0)

  // Back to the list without closing the editor tab, then open the same
  // workflow again -- must switch to the existing tab, not open a second.
  await page.getByRole('tab', { name: 'Workflows' }).click()
  await row.click()
  await expect(outerTabs).toHaveCount(2)

  await page.getByRole('tab', { name: 'Workflows' }).click()
  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
})
