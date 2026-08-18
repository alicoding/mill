import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import { workflowRow, activePanel, dragPaletteItemToCanvas, connectNodes } from './fixtures/canvas'

// docs/adr/0028's authoring-validation panel + the severity contract
// (errors block save, warnings never do), driven through the real
// canvas -- not just the Go-level ValidateGraph/ValidateGraphStrict
// unit tests (internal/domain/composition/graph_test.go). Covers the
// three acceptance scenarios named in goal 0008: (a) a workflow whose
// root isn't a Trigger can no longer save, with the error named in
// the issues panel; (b) a
// trigger-rooted workflow ending in a Process leaf saves anyway, with
// a visible warning on both the toolbar badge and the node itself, and
// clicking the panel row selects that node; (c) an existing seeded
// workflow that already ends in a Process leaf shows the same warning
// live, proving nothing else broke.

// Removes the pre-populated starter node -- test (a) needs an exact,
// known single-node graph (a lone Capture, no Trigger at all), not
// "the starter plus whatever I added." Selects it by clicking a point
// PROVEN to land inside its own card, not a fixed offset -- see
// composition-canvas-interactions.spec.ts's/child-workflow.spec.ts's own
// copies of this pattern for the full MiniMap/Controls-overlap reasoning
// (a plain `.click()` targets the card's center, which React Flow's own
// Controls/MiniMap chrome can sit under depending on layout); this
// file's own copy, since the helper is deliberately per-file. There's
// only ever one node at this point (a brand-new workflow's starter), so
// no label filter is needed.
async function deleteStarterNode(page: import('@playwright/test').Page) {
  const node = activePanel(page).locator('.react-flow__node').first()
  const box = await node.boundingBox()
  if (!box) throw new Error('deleteStarterNode: starter node has no bounding box')
  const candidates = [
    { x: box.x + 10, y: box.y + 10 },
    { x: box.x + box.width - 10, y: box.y + 10 },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    { x: box.x + 10, y: box.y + box.height - 10 },
  ]
  let clicked = false
  for (const point of candidates) {
    const insideNode = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      return !!el?.closest('.react-flow__node')
    }, point)
    if (insideNode) {
      await page.mouse.click(point.x, point.y)
      clicked = true
      break
    }
  }
  if (!clicked) throw new Error('deleteStarterNode: no candidate point resolved inside the starter node\'s own card')
  await activePanel(page).getByRole('button', { name: 'Delete selected' }).click()
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(0)
}

// The debounced ValidateDraft round trip (useDraftValidation.ts: 500ms
// debounce + a real RPC) needs real slack beyond the debounce itself.
const VALIDATION_TIMEOUT = 5_000

test('A workflow whose root is not a Trigger cannot be saved, with the error named in the issues panel', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await deleteStarterNode(page)
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'capture-clipboard-html')
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(1)

  // Nothing hidden: the badge already flags this before Save is even
  // clicked. One error (non-Trigger root) plus one warning (the lone
  // Capture node is also a dangling leaf).
  const badge = activePanel(page).getByTestId('validation-badge')
  await expect(badge).toBeVisible({ timeout: VALIDATION_TIMEOUT })
  await expect(badge).toContainText('1 error')

  await badge.click()
  // AnchoredOverlay portals its content outside the tabpanel's own DOM
  // subtree (same as WorkflowHoverPreview.tsx/clickRowAction's own
  // documented reasoning) -- looked up at the page level, not scoped to
  // activePanel().
  const panel = page.getByTestId('validation-panel')
  await expect(panel).toBeVisible()
  const rootIssue = panel.getByTestId('validation-issue').filter({ hasText: 'must start with a Trigger step' })
  await expect(rootIssue).toBeVisible()
  await expect(rootIssue).toHaveAttribute('data-severity', 'error')
  // The paste-anywhere copy affordance (asked for directly from live
  // use): present whenever the panel is; content is unit-tested
  // (validationCopy.test.ts), presence is what e2e owns here.
  await expect(panel.getByTestId('copy-issues')).toBeVisible()

  await activePanel(page).getByLabel('Label').fill('E2E non-trigger-root repro')
  await activePanel(page).getByTestId('save-workflow').click()
  await expect(activePanel(page).getByText(/must start with a Trigger step/)).toBeVisible()

  // Rejected means nothing was actually saved.
  await page.getByRole('tab', { name: 'Workflows' }).click()
  await expect(workflowRow(page, 'E2E non-trigger-root repro')).toHaveCount(0)
})

test('A Trigger -> Process-leaf workflow saves with a warning; the toolbar and node both badge it, and the panel row selects the node', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()

  // Keep the starter trigger-manual node -- connect it straight into a
  // Process node with nothing downstream, exactly the "computed
  // something, delivered it nowhere" warning shape (docs/adr/0028).
  await dragPaletteItemToCanvas(page, 'process-inject-text')
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(2)
  await connectNodes(page, 'Manual run', 'Add text')
  await expect(activePanel(page).locator('.react-flow__edge')).toHaveCount(1)

  const badge = activePanel(page).getByTestId('validation-badge')
  await expect(badge).toBeVisible({ timeout: VALIDATION_TIMEOUT })
  await expect(badge).toContainText('warning')
  await expect(badge).not.toContainText('error')

  const nodeBadge = activePanel(page).getByTestId('node-validation-badge')
  await expect(nodeBadge).toHaveCount(1)
  await expect(nodeBadge).toHaveAttribute('data-severity', 'warning')

  await badge.click()
  const panel = page.getByTestId('validation-panel')
  await expect(panel).toBeVisible()
  const leafIssue = panel.getByTestId('validation-issue').filter({ hasText: "isn't delivered anywhere" })
  await expect(leafIssue).toBeVisible()
  await expect(leafIssue).toHaveAttribute('data-severity', 'warning')

  // Clicking the issue selects its node -- proven by the Inspector now
  // showing that node's own type, not "select a node to configure it."
  await leafIssue.click()
  await expect(activePanel(page).getByTestId('composition-inspector')).toContainText('Add text')

  // Legal to save despite the warning (errors block, warnings never do).
  await activePanel(page).getByLabel('Label').fill('E2E process-leaf workflow')
  await activePanel(page).getByTestId('save-workflow').click()
  const row = workflowRow(page, 'E2E process-leaf workflow')
  await expect(row).toBeVisible()

  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
})

test('An existing seed ending in a Process leaf (Example: Approval-gated HTTP call) shows the same warning live, nothing else broken', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText('Example: Approval-gated HTTP call', { exact: true }) })
  await expect(row).toBeVisible()
  await row.click()

  const badge = activePanel(page).getByTestId('validation-badge')
  await expect(badge).toBeVisible({ timeout: VALIDATION_TIMEOUT })
  await expect(badge).toContainText('1 warning')
  await expect(badge).not.toContainText('error')

  // Coexists cleanly with this same seed's own guardrail "ask" badge
  // (guardrail.spec.ts) -- distinct icon/position, both visible at once.
  await expect(activePanel(page).getByTestId('node-validation-badge')).toHaveAttribute('data-severity', 'warning')
  await expect(activePanel(page).getByTestId('canvas-guardrail-badge')).toHaveAttribute('data-effect', 'ask')
})
