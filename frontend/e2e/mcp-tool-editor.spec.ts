import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

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
  return page.locator('[data-testid="workflow-row"]', { has: page.getByText(label, { exact: true }) })
}

function mcpServerRow(page: import('@playwright/test').Page, label: string) {
  return page.getByTestId('mcpserver-row').filter({ has: page.getByText(label, { exact: true }) })
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

async function deleteStarterNode(page: import('@playwright/test').Page) {
  await activePanel(page).locator('.react-flow__node').click()
  await activePanel(page).getByRole('button', { name: 'Delete selected' }).click()
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(0)
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
  await deleteStarterNode(page)
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'mcp-tool-call')
  await activePanel(page).locator('.react-flow__node').click()

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
  await workflowRow(page, 'E2E MCP tool editor workflow').getByRole('button', { name: /Delete/ }).click()
  await expect(workflowRow(page, 'E2E MCP tool editor workflow')).toHaveCount(0)

  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'MCP Servers' }).click()
  await mcpServerRow(page, 'E2E MCP fixture').first().getByRole('button', { name: 'Delete E2E MCP fixture' }).click()
  await expect(mcpServerRow(page, 'E2E MCP fixture')).toHaveCount(0)
})
