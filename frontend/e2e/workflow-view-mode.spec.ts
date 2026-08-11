import { test, expect } from './fixtures/server'

// docs/goals/0022-workflow-view-mode.md end to end: a workflow row
// click opens VIEW mode (read-only canvas, Run/Runs/Versions/breakpoints
// all still live), and Edit is the one explicit gesture that switches
// the SAME tab into the full editor in place.

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

function activePanel(page: import('@playwright/test').Page) {
  return page.locator('[role="tabpanel"]:not([hidden])').last()
}

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
  const node = panel.locator('.react-flow__node').filter({ hasText: 'Apply: write HTML to clipboard' })
  const box = await node.boundingBox()
  if (!box) throw new Error('node has no bounding box')
  const transformBefore = await node.getAttribute('style')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 150, { steps: 10 })
  await page.mouse.up()
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
