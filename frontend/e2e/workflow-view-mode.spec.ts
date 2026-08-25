import { test, expect } from './fixtures/server'
import { workflowRow, activePanel, dragNodeBy } from './fixtures/canvas'
import { clickCanvasNode } from './fixtures/canvasNode'

// docs/goals/0022-workflow-view-mode.md end to end: a workflow row
// click opens VIEW mode (read-only canvas, Run/Runs/Versions/breakpoints
// all still live), and Edit is the one explicit gesture that switches
// the SAME tab into the full editor in place.

test('Row click opens VIEW mode: no palette toggle, a drag attempt does not move the node, Runs/Versions stay reachable', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await workflowRow(page, 'Load sample HTML').click()

  const panel = activePanel(page)
  // trigger-manual + apply-clipboard-write-html (every workflow needs a
  // Trigger root, docs/adr/0028).
  await expect(panel.locator('.react-flow__node')).toHaveCount(2)

  // No editing affordances at all -- absent, not just disabled (the
  // goal's own acceptance bullet).
  await expect(panel.getByTestId('toggle-palette')).toHaveCount(0)
  await expect(page.getByTestId('save-workflow')).toHaveCount(0)
  await expect(page.getByTestId('edit-workflow')).toBeVisible()

  // A drag attempt on the node is a real no-op -- nodesDraggable=false
  // (docs/goals/0022) means React Flow's own drag handler never starts.
  // Reads the node's own `transform: translate(x,y)` inline style (its
  // FLOW-coordinate model position, @xyflow/react's NodeWrapper) rather
  // than a screen-pixel boundingBox -- a boundingBox would also move if
  // the drag gesture were instead absorbed as a PANE pan (a separate,
  // still-legal interaction unrelated to what this goal disables),
  // which would falsely look like "the node moved" even though its own
  // model position never changed. The Apply node specifically (not the
  // Trigger) -- the breakpoint toggle below is excluded from Trigger
  // nodes (NodeGuardrailSection.tsx's own exclusion, carried over to
  // the card by breakpoints.ts).
  const node = panel.locator('.react-flow__node').filter({ hasText: 'Write HTML to clipboard' })
  const transformBefore = await node.getAttribute('style')
  await dragNodeBy(page, node, 150, 150)
  const transformAfter = await node.getAttribute('style')
  expect(transformAfter).toBe(transformBefore)

  // Runs and Versions inner tabs stay fully reachable in view mode.
  await page.getByRole('tab', { name: 'Runs' }).click()
  await expect(page.getByTestId('workflow-runs-panel')).toBeVisible()
  await page.getByRole('tab', { name: 'Versions' }).click()
  await expect(page.getByTestId('workflow-versions-panel')).toBeVisible()
  await page.getByRole('tab', { name: 'Canvas' }).click()

  // The breakpoint dot on the node card is a debug act, not an edit --
  // it works from view mode too (docs/adr/0031, moved off the Inspector
  // by this same goal). Full pause/resume coverage lives in
  // breakpoints.spec.ts; this just proves the toggle itself is reachable
  // and round-trips without ever leaving view mode.
  const toggle = node.getByTestId('canvas-breakpoint-toggle')
  await expect(toggle).toHaveAttribute('data-set', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('data-set', 'true', { timeout: 10_000 })
  await toggle.click()
  await expect(toggle).toHaveAttribute('data-set', 'false', { timeout: 10_000 })

  // Edit switches this SAME tab in place -- no second tab opens, the
  // strip's own tab count/label/icon stay exactly as they were.
  const outerTabs = page.getByRole('tablist', { name: 'Open work' }).getByRole('tab')
  await expect(outerTabs).toHaveCount(2) // Workflows + this one editor tab
  await page.getByTestId('edit-workflow').click()
  await expect(outerTabs).toHaveCount(2)
  await expect(outerTabs.nth(1)).toHaveText('Load sample HTML')
  await expect(page.getByTestId('save-workflow')).toBeVisible()
  await expect(panel.getByTestId('toggle-palette')).toBeVisible()

  await page.getByRole('button', { name: 'Close tab' }).last().click()
})

test('Run works from view mode without switching to Edit', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  // Deterministic, no clipboard I/O (unlike "Load sample HTML") -- the
  // same seed breakpoints.spec.ts already relies on for this reason.
  const seed = 'Example: Branch to a decision'
  await workflowRow(page, seed).click()

  const panel = activePanel(page)
  await expect(page.getByTestId('save-workflow')).toHaveCount(0)

  await panel.getByTestId('canvas-run').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Amount').fill('150')
  await dialog.getByRole('button', { name: 'Run' }).click()

  const bar = panel.getByTestId('current-step-bar')
  await expect(bar).toContainText('SUCCESS', { timeout: 15_000 })
  // Still read-only throughout the run -- no Save button appeared.
  await expect(page.getByTestId('save-workflow')).toHaveCount(0)

  await page.getByTestId('dismiss-run-state').click()
})

// docs/goals/0036-view-mode-ux-hardening.md item 1: the table view
// (WorkflowsTable.tsx) had NO entry into view mode at all -- only the
// pencil, straight to Edit. The Label cell is now the same click-to-view
// affordance InventoryList's row view already gives for free.
test('Table view: clicking a workflow label opens VIEW mode, not Edit', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByRole('button', { name: 'Table view' }).click()

  const table = page.getByRole('table', { name: 'Saved workflows' })
  await expect(table).toBeVisible()
  // exact: true -- the row's own Edit/Export/Delete/Run IconButtons all
  // carry aria-labels that CONTAIN "Load sample HTML" as a substring
  // ("Edit Load sample HTML" etc.), which would otherwise also match.
  await table.getByRole('button', { name: 'Load sample HTML', exact: true }).click()

  const panel = activePanel(page)
  await expect(panel.locator('.react-flow__node')).toHaveCount(2)
  await expect(page.getByTestId('save-workflow')).toHaveCount(0)
  await expect(page.getByTestId('edit-workflow')).toBeVisible()

  await page.getByRole('button', { name: 'Close tab' }).last().click()
  // Restore row view so other specs relying on the default aren't
  // affected by this file's own table-view toggle (view-mode-toggle.
  // spec.ts's own restore convention, localStorage persists across specs).
  await page.getByRole('button', { name: 'Row view' }).click()
})

// docs/goals/0036-view-mode-ux-hardening.md item 2: the ambient cue that
// a tab is read-only, visible the moment it opens -- before a user ever
// selects a node and discovers the Inspector is inert.
test('View-mode chip is present in view, absent once switched to Edit', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await workflowRow(page, 'Load sample HTML').click()

  const chip = page.getByTestId('view-mode-chip')
  await expect(chip).toBeVisible()
  await expect(chip).toContainText('Viewing')

  await page.getByTestId('edit-workflow').click()
  await expect(chip).toHaveCount(0)
  await expect(page.getByTestId('save-workflow')).toBeVisible()

  await page.getByRole('button', { name: 'Close tab' }).last().click()
})

// docs/goals/0036-view-mode-ux-hardening.md item 3: the native <fieldset
// disabled> already blocks every Inspector field FUNCTIONALLY (proven by
// the drag/breakpoint test above and by composition-canvas-interactions.
// spec.ts's own editing coverage never running against a view tab) -- this
// proves the still-missing VISUAL half landed: a selected node's config
// fieldset actually renders muted in view mode, and full-strength again
// once switched to Edit, the same node still selected.
test('View mode: inspector fields render visibly muted, not just functionally blocked', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await workflowRow(page, 'Load sample HTML').click()

  const panel = activePanel(page)
  await clickCanvasNode(page, panel, 'Write HTML to clipboard')
  const fieldset = panel.getByTestId('inspector-fieldset')
  await expect(fieldset).toHaveCSS('opacity', '0.6')
  await expect(fieldset).toHaveCSS('cursor', 'not-allowed')

  await page.getByTestId('edit-workflow').click()
  await clickCanvasNode(page, panel, 'Write HTML to clipboard')
  await expect(panel.getByTestId('inspector-fieldset')).toHaveCSS('opacity', '1')

  await page.getByRole('button', { name: 'Close tab' }).last().click()
})
