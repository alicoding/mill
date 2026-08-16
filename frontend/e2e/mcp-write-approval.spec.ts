import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import {
  connectMCPClient, exportWorkflowViaMCP, findWorkflowIdByLabel, stripExportedID,
  enableMCPWritesWithApprovalRequired, restoreMCPWriteDefaults,
} from './mcpTestClient'
import { workflowRow } from './fixtures/canvas'

// The park-and-poll MCP write approval lifecycle end to end
// (docs/adr/0032): with writes enabled AND per-write approval left
// required (the default -- unlike canvas-live-sync.spec.ts's
// "unattended" helper, this spec needs the park to actually happen), a
// gated import_workflow call over a REAL MCP client parks as a durable
// pending record. It must show up as an actionable row in the Review
// queue (ReviewView.tsx's pendingWrites section) -- the same durable
// store the MCPWriteApprovals.tsx banner reads -- and approving it
// there must execute the write, minting the new workflow.

test('a parked MCP write appears as a Review row and approving it there executes the write', async ({ page }, testInfo) => {
  await enableMCPWritesWithApprovalRequired(page)

  // A source workflow to export/re-import (import always mints a new
  // ID -- the exact gated write this lifecycle protects).
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await page.locator('[role="tabpanel"]:not([hidden])').last().getByLabel('Label').fill('E2E MCP write approval source')
  await page.locator('[role="tabpanel"]:not([hidden])').last().getByTestId('save-workflow').click()
  await expect(workflowRow(page, 'E2E MCP write approval source')).toBeVisible()

  const client = await connectMCPClient(testInfo.parallelIndex)
  let importResultPromise: ReturnType<Client['callTool']>
  try {
    const sourceId = await findWorkflowIdByLabel(client, 'E2E MCP write approval source')
    const exported = await exportWorkflowViaMCP(client, sourceId)

    // Fire the gated import -- with approval required, this call
    // parks (courtesy window default 10s in production; the request
    // is durable regardless of how long the call itself keeps
    // waiting) rather than completing immediately.
    importResultPromise = client.callTool({ name: 'import_workflow', arguments: { json: stripExportedID(exported) } })

    // The Review queue surfaces it as an actionable row -- the SAME
    // durable pending store the banner reads (docs/adr/0032 §2).
    await page.getByRole('link', { name: 'Review' }).click()
    const item = page.getByTestId('review-mcp-write-item').first()
    await expect(item).toBeVisible({ timeout: 15_000 })
    await expect(item).toContainText('import a workflow')

    await item.getByTestId('review-mcp-write-approve').click()
    await expect(page.getByTestId('review-mcp-write-item')).toHaveCount(0, { timeout: 10_000 })

    // The write actually executed: a second workflow with the same
    // label now exists (import always mints a new ID, never overwrites).
    await page.getByRole('link', { name: 'Workflows' }).click()
    await expect(workflowRow(page, 'E2E MCP write approval source')).toHaveCount(2, { timeout: 10_000 })

    // The original MCP call itself must have resolved successfully
    // once approved (whether it was still in its courtesy window or
    // had already returned the parked-pending text) -- not left
    // hanging or erroring.
    const result = await importResultPromise
    if (result.isError) {
      throw new Error(`import_workflow ultimately errored after approval: ${JSON.stringify(result.content)}`)
    }
  } finally {
    await client.close()
  }

  // Cleanup: both minted workflows (deleted one at a time -- re-query
  // after each delete rather than snapshotting .all() up front, since
  // the DOM shifts as each row disappears), and the settings toggle.
  let remaining = await workflowRow(page, 'E2E MCP write approval source').count()
  while (remaining > 0) {
    await clickRowAction(page, workflowRow(page, 'E2E MCP write approval source').first(), 'Delete')
    remaining -= 1
    await expect(workflowRow(page, 'E2E MCP write approval source')).toHaveCount(remaining)
  }
  await restoreMCPWriteDefaults(page)
})
