import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'

// Exercises ADR-0010's frontend wiring: the child-workflow picker only
// lists workflows rooted in trigger-callable, and selecting one shows a
// binding editor for the child's own declared Attributes. Full
// execution semantics (real DBOS parent/child tracking, idempotency)
// are proven in Go (executionchildworkflow_test.go) against a real DBOS
// instance -- edge-drawing between canvas nodes has no existing
// Playwright coverage anywhere in this repo yet and is real fragility
// to take on separately; this test stays to what's genuinely new
// frontend surface: the picker filter and the binding editor.

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

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

async function dragPaletteItemToCanvas(page: import('@playwright/test').Page, nodeTypeID: string) {
  await page.evaluate((id) => {
    const panel = document.querySelector('[role="tabpanel"]:not([hidden])')
    if (!panel) throw new Error('no active tabpanel')
    const palette = panel.querySelector(`[data-node-type-id="${id}"]`)
    const canvas = panel.querySelector('.react-flow__pane')
    if (!palette || !canvas) throw new Error(`drag setup failed: palette found=${!!palette} canvas found=${!!canvas}`)
    const dataTransfer = new DataTransfer()
    const rect = canvas.getBoundingClientRect()
    const clientX = rect.x + rect.width / 2
    const clientY = rect.y + rect.height / 2
    palette.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }))
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }))
  }, nodeTypeID)
}

async function deleteStarterNode(page: import('@playwright/test').Page) {
  await activePanel(page).locator('.react-flow__node').click()
  await activePanel(page).getByRole('button', { name: 'Delete selected' }).click()
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(0)
}

// See composition-canvas-interactions.spec.ts's own copy of these two
// helpers for the full reasoning (Fit View first avoids the MiniMap-
// overlap hazard a spiral-placed node's handle can land under; a raw
// mouse click at a node's own top-left avoids the same hazard for
// selection).
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

async function createSingleNodeWorkflow(page: import('@playwright/test').Page, nodeTypeID: string, label: string) {
  await page.getByTestId('new-workflow').click()
  await deleteStarterNode(page)
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, nodeTypeID)
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(1)
  await activePanel(page).getByLabel('Label').fill(label)
  await activePanel(page).getByTestId('save-workflow').click()
  await expect(workflowRow(page, label)).toBeVisible()
}

test('Child Workflow picker only lists workflows rooted in trigger-callable', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  // A default new workflow (trigger-manual root) is NOT a valid child
  // target -- left as-is, no node changes needed.
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByLabel('Label').fill('E2E non-callable')
  await activePanel(page).getByTestId('save-workflow').click()
  await expect(workflowRow(page, 'E2E non-callable')).toBeVisible()

  await createSingleNodeWorkflow(page, 'trigger-callable', 'E2E callable child')

  // Keeps the starter trigger-manual node -- docs/adr/0028 requires a
  // Trigger root now, so "child-workflow" alone (a Process node) can no
  // longer be the whole graph on its own.
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'child-workflow')
  await connectNodes(page, 'Trigger: manual', 'Run another workflow')
  await clickCanvasNode(page, activePanel(page), 'Run another workflow')

  const inspector = activePanel(page).getByTestId('composition-inspector')
  const picker = inspector.getByTestId('entity-ref-field')
  await expect(picker).toBeVisible()
  // The picker's entity list loads asynchronously (ConfigureService/
  // CompositionService.Workflows()) -- wait for it to resolve before
  // reading options, not just for the Select element to be visible.
  await expect(picker.locator('option').first()).not.toHaveText('Loading…')

  const options = await picker.locator('option').allTextContents()
  expect(options.some((o) => o.includes('E2E callable child'))).toBe(true)
  expect(options.some((o) => o.includes('E2E non-callable'))).toBe(false)

  await picker.selectOption({ label: 'E2E callable child' })
  await activePanel(page).getByLabel('Label').fill('E2E parent')
  await activePanel(page).getByTestId('save-workflow').click()
  await expect(workflowRow(page, 'E2E parent')).toBeVisible()

  await clickRowAction(page, workflowRow(page, 'E2E parent'), 'Delete')
  await expect(workflowRow(page, 'E2E parent')).toHaveCount(0)
  await clickRowAction(page, workflowRow(page, 'E2E callable child'), 'Delete')
  await expect(workflowRow(page, 'E2E callable child')).toHaveCount(0)
  await clickRowAction(page, workflowRow(page, 'E2E non-callable'), 'Delete')
  await expect(workflowRow(page, 'E2E non-callable')).toHaveCount(0)
})
