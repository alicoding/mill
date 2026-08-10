import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'

// Exercises the mcp-tool-call node's schema-driven arguments editor
// (docs/SPEC.md §3.6, MCPToolArgsEditor.tsx) over a real, spawned MCP
// server subprocess -- fixtures/mcp-fixture-server.mjs, a minimal
// stdio MCP server exposing one "greet" tool -- not a mock, the same
// "test against something real" bar internal/adapters/mcpclient's own
// tests already set.
//
// Deletes both the workflow and the MCP Server it creates -- same
// shared-settings-file accumulation risk configure-requests.spec.ts's
// own header comment documents.

const fixturePath = fileURLToPath(new URL('./fixtures/mcp-fixture-server.mjs', import.meta.url))

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

function mcpServerRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="mcpserver"]').filter({ has: page.getByText(label, { exact: true }) })
}

// .last(), not a bare match: a saved workflow's editor tab now nests a
// second Canvas/Runs tab bar inside the outer per-workflow tab
// (docs/SPEC.md §7's Update), so up to two [role="tabpanel"]:not([hidden])
// elements can be visible at once -- document order always puts the
// outer one first, so .last() reliably resolves to the innermost, most
// specific panel regardless of whether a workflow has an inner tab bar.
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

test('mcp-tool-call node: schema-driven typed argument fields once a real tool is picked, raw fallback before then', async ({ page }) => {
  await page.goto('/')

  // 1. Create the MCP Server entity, pointed at the real fixture
  // subprocess (an absolute path -- resolved from this spec file, not
  // hardcoded, so it survives running from any checkout location).
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'MCP Servers' }).click()
  await page.getByTestId('new-mcpserver').click()
  await page.getByLabel('Label').fill('E2E MCP fixture')
  await page.getByLabel('Command').fill('node')
  await page.getByPlaceholder('--flag').fill(fixturePath)
  await page.getByRole('button', { name: 'Save MCP server' }).click()
  await expect(mcpServerRow(page, 'E2E MCP fixture')).toBeVisible()

  // 2. Create a workflow, drag an mcp-tool-call node on, select it.
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
  // Keeps the starter trigger-manual node -- docs/adr/0028 requires a
  // Trigger root, so mcp-tool-call alone can no longer be the whole
  // graph on its own.
  await dragPaletteItemToCanvas(page, 'mcp-tool-call')
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(2)
  await connectNodes(page, 'Trigger: manual', 'MCP: tool call')
  await clickCanvasNode(page, activePanel(page), 'MCP: tool call')

  const inspector = activePanel(page).getByTestId('composition-inspector')
  const editor = inspector.getByTestId('mcp-tool-args-editor')
  await expect(editor).toBeVisible()

  // 8. Fallback, asserted BEFORE a server is picked: plain toolName
  // text input and a raw args textarea, nothing schema-driven yet.
  await expect(editor.getByTestId('mcp-tool-name-input')).toBeVisible()
  await expect(editor.getByTestId('mcp-args-raw')).toBeVisible()
  await expect(editor.getByTestId('mcp-tool-select')).toHaveCount(0)

  // 3. Pick the created server.
  await inspector.getByTestId('entity-ref-field').selectOption({ label: 'E2E MCP fixture' })

  // 4. The tool Select appears once the server's real tool list is
  // fetched (a subprocess spawn is involved -- generous timeout).
  const toolSelect = editor.getByTestId('mcp-tool-select')
  await expect(toolSelect).toBeVisible({ timeout: 20_000 })
  await expect(toolSelect).toContainText('greet', { timeout: 20_000 })
  await expect(editor.getByTestId('mcp-tool-name-input')).toHaveCount(0)

  // 5. Pick greet; typed fields render, name is marked required.
  await toolSelect.selectOption({ label: 'greet' })
  await expect(editor).toContainText('Say hello to someone')
  await expect(editor.getByLabel('name literal value')).toBeVisible()
  await expect(editor).toContainText('required')
  await expect(editor.getByTestId('mcp-arg-number')).toBeVisible()
  await expect(editor.getByTestId('mcp-arg-boolean')).toBeVisible()

  // 6. Fill the typed fields, then read back the raw JSON -- numbers
  // and booleans must stay typed, not stringified.
  await editor.getByLabel('name literal value').fill('world')
  await editor.getByTestId('mcp-arg-number').fill('3')
  await editor.getByTestId('mcp-arg-boolean').check()

  await editor.getByTestId('mcp-args-raw-toggle').click()
  const rawJSON = await editor.getByTestId('mcp-args-raw').inputValue()
  expect(JSON.parse(rawJSON)).toEqual({ name: 'world', count: 3, loud: true })

  await activePanel(page).getByLabel('Label').fill('E2E MCP tool editor workflow')
  await activePanel(page).getByTestId('save-workflow').click()
  await expect(workflowRow(page, 'E2E MCP tool editor workflow')).toBeVisible()

  // 7. Cleanup: delete the workflow and the MCP server.
  await clickRowAction(page, workflowRow(page, 'E2E MCP tool editor workflow'), 'Delete')
  await expect(workflowRow(page, 'E2E MCP tool editor workflow')).toHaveCount(0)

  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'MCP Servers' }).click()
  await clickRowAction(page, mcpServerRow(page, 'E2E MCP fixture').first(), 'Delete')
  await expect(mcpServerRow(page, 'E2E MCP fixture')).toHaveCount(0)
})
