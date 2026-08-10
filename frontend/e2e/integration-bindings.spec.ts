import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'

// Exercises ADR-0007 Phase 3: once integration-http's requestId/path/
// method match a declared operation on the request's OpenAPI spec, the
// canvas Inspector renders a real binding editor (IntegrationBindingsEditor.tsx)
// instead of leaving bodyTemplate as the only option -- over real Go
// bindings (Wails3 server mode), not mocks.
//
// Deletes both the workflow and the request it creates -- same
// shared-settings-file accumulation risk configure-requests.spec.ts's
// own header comment documents.

const bindingSpec = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Widgets', version: '1.0.0' },
  paths: {
    '/widgets/{id}': {
      post: {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { note: { type: 'string' } } } } } },
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { name: { type: 'string' }, token: { type: 'string', format: 'password' } } },
              },
            },
          },
        },
      },
    },
  },
})

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

function requestRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="request"]').filter({ has: page.getByText(label, { exact: true }) })
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

test('Matching an Integration node to a declared operation shows a binding editor with a secret field guarded', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('E2E bindings request')
  await page.getByLabel('URL', { exact: true }).fill('https://api.example.com')
  await page.getByTestId('toggle-raw-openapi').click()
  await page.getByTestId('request-openapi-spec').fill(bindingSpec)
  await page.getByRole('button', { name: 'Save request' }).click()
  await expect(requestRow(page, 'E2E bindings request')).toBeVisible()

  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
  // Keeps the starter trigger-manual node -- docs/adr/0028 requires a
  // Trigger root, so Integration alone can no longer be the whole graph.
  await dragPaletteItemToCanvas(page, 'integration-http')
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(2)
  await connectNodes(page, 'Trigger: manual', 'Integration: HTTP call')
  await clickCanvasNode(page, activePanel(page), 'Integration: HTTP call')

  const inspector = activePanel(page).getByTestId('composition-inspector')
  await inspector.getByTestId('entity-ref-field').selectOption({ label: 'E2E bindings request' })

  // No path/method to fill -- transport lives on the integration
  // itself now (its single declared operation), and the bindings
  // editor resolves it automatically once the integration is picked.
  const editor = inspector.getByTestId('integration-bindings-editor')
  await expect(editor).toBeVisible()
  await expect(editor).toContainText('id')
  await expect(editor).toContainText('note')
  await expect(editor).toContainText('name')
  // The secret output field is labeled, not offered as a bindable Select.
  await expect(editor).toContainText('token')
  await expect(editor).toContainText('secret')
  await expect(editor).toContainText('Secret fields cannot be written to an Attribute.')

  await inspector.getByLabel('id literal value').fill('w-42')
  await inspector.getByLabel('note literal value').fill('hello')

  await activePanel(page).getByLabel('Label').fill('E2E bindings workflow')
  await activePanel(page).getByTestId('save-workflow').click()
  await expect(workflowRow(page, 'E2E bindings workflow')).toBeVisible()

  await clickRowAction(page, workflowRow(page, 'E2E bindings workflow'), 'Delete')
  await expect(workflowRow(page, 'E2E bindings workflow')).toHaveCount(0)

  await page.getByRole('link', { name: 'Configure' }).click()
  await clickRowAction(page, requestRow(page, 'E2E bindings request').first(), 'Delete')
  await expect(requestRow(page, 'E2E bindings request')).toHaveCount(0)
})
