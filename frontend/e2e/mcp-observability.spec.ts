import { test, expect } from './fixtures/server'
import { connectMCPClient, exportWorkflowViaMCP, findWorkflowIdByLabel } from './mcpTestClient'
import { workflowRow } from './fixtures/canvas'

// goal 0159 slice 1: a REAL server-side MCP tool call -- over the
// actual streamable-HTTP MCP server via mcpTestClient's own real
// protocol client, the same shape every mcp-write-approval-style spec
// already uses, not an in-memory shortcut -- must be recorded and show
// up in Activity's MCP calls section. Proves the middleware/storage/
// bound-API chain end to end; the middleware unit tests
// (mcpauditservice_middleware_test.go) and the agent-loop coverage
// proof (millmcpservice_audit_test.go) cover the rest of that chain at
// the Go layer.
test('a real MCP tool call appears in Activity\'s MCP calls section', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await page.locator('[role="tabpanel"]:not([hidden])').last().getByLabel('Label').fill('E2E MCP observability source')
  await page.locator('[role="tabpanel"]:not([hidden])').last().getByTestId('save-workflow').click()
  await expect(workflowRow(page, 'E2E MCP observability source')).toBeVisible()

  const client = await connectMCPClient(testInfo.parallelIndex)
  try {
    const workflowId = await findWorkflowIdByLabel(client, 'E2E MCP observability source')
    await exportWorkflowViaMCP(client, workflowId)
  } finally {
    await client.close()
  }

  await page.getByRole('link', { name: 'Activity' }).click()
  await page.getByTestId('mcp-calls-tool-filter').fill('export_workflow')

  const row = page.getByTestId('mcp-call-row').first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  await expect(row).toContainText('export_workflow')
  await expect(row).toContainText('Succeeded')
})
