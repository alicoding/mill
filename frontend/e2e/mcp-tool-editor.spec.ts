import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import { workflowRow, activePanel, dragPaletteItemToCanvas, connectNodes } from './fixtures/canvas'
import { clickCanvasNode } from './fixtures/canvasNode'

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

function mcpServerRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="mcpserver"]').filter({ has: page.getByText(label, { exact: true }) })
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
