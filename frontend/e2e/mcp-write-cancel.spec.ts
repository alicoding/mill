import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import {
  connectMCPClient, exportWorkflowViaMCP, findWorkflowIdByLabel,
  enableMCPWritesWithApprovalRequired, restoreMCPWriteDefaults,
} from './mcpTestClient'
import { workflowRow } from './fixtures/canvas'

// docs/goals/0026 items 1 and 5: the requester's own withdrawal of a
// pending MCP write (cancel_write, a distinct outcome from denied), and
// the badge-staleness bug fix (every resolution path -- approve, deny,
// cancel, expiry -- must ping the pending-changed signal, not just a
// new park). The parked write's own id is read off the Review row's
// `data-mcp-write-id` attribute (ReviewView.tsx) rather than awaited
// from the original import_workflow call's own eventual result text --
// that call only resolves once the production 10s courtesy window
// elapses (or a decision lands first), which would make id-extraction
// itself race the window; the row appears immediately on park,
// independent of the courtesy window.

async function createSourceWorkflow(page: Page, label: string) {
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await page.locator('[role="tabpanel"]:not([hidden])').last().getByLabel('Label').fill(label)
  await page.locator('[role="tabpanel"]:not([hidden])').last().getByTestId('save-workflow').click()
  await expect(workflowRow(page, label)).toBeVisible()
}

async function cleanupWorkflow(page: Page, label: string) {
  const row = workflowRow(page, label)
  if (await row.count() > 0) {
    await clickRowAction(page, row.first(), 'Delete')
    await expect(workflowRow(page, label)).toHaveCount(0)
  }
}

// The full withdraw lifecycle over a real MCP client: park -> cancel ->
// status cancelled -> nothing written -> the Review row and the sidebar
// badge both drop, driven purely by the event cancel_write now fires
// (never a manual page action).
test('cancel_write withdraws a pending MCP write: parked -> cancelled -> nothing written -> banner/queue count drops', async ({ page }, testInfo) => {
  const label = 'E2E MCP write cancel source'
  await enableMCPWritesWithApprovalRequired(page)
  await createSourceWorkflow(page, label)

  const client = await connectMCPClient(testInfo.parallelIndex)
  try {
    const sourceId = await findWorkflowIdByLabel(client, label)
    const exported = await exportWorkflowViaMCP(client, sourceId)

    // Fire the gated import in the background -- with approval required
    // this parks rather than resolving immediately; the promise itself
    // isn't awaited until after cancel_write below, since it only
    // settles once the courtesy window elapses or a decision lands.
    const importResultPromise = client.callTool({ name: 'import_workflow', arguments: { json: exported } })

    await page.getByRole('link', { name: 'Review' }).click()
    const item = page.getByTestId('review-mcp-write-item').first()
    await expect(item).toBeVisible({ timeout: 15_000 })
    await expect(item).toContainText('import a workflow')
    // The sidebar badge counts this pending write too (docs/goals/0026
    // item 5's own signal, shared with the guardrail badge test in
    // guardrail.spec.ts).
    await expect(page.getByTestId('review-pending-count')).toHaveText('1', { timeout: 10_000 })

    const id = await item.getAttribute('data-mcp-write-id')
    expect(id).toBeTruthy()

    const cancelRes = await client.callTool({ name: 'cancel_write', arguments: { id } })
    expect(cancelRes.isError, `cancel_write failed: ${JSON.stringify(cancelRes.content)}`).toBeFalsy()

    // Review row disappears, and the badge (the same phantom-1 bug this
    // item exists to fix) drops back to zero -- purely event-driven,
    // no manual reload/navigation in between.
    await expect(page.getByTestId('review-mcp-write-item')).toHaveCount(0, { timeout: 10_000 })
    await expect(page.getByTestId('review-pending-count')).toHaveCount(0, { timeout: 10_000 })

    // Nothing was written: only the one original workflow exists.
    await page.getByRole('link', { name: 'Workflows' }).click()
    await expect(workflowRow(page, label)).toHaveCount(1, { timeout: 10_000 })

    // status is "cancelled", a distinct outcome from "denied".
    const statusRes = await client.callTool({ name: 'check_write_status', arguments: { id } })
    const statusText = (statusRes.content?.[0] as { type: string; text?: string } | undefined)?.text ?? ''
    expect(JSON.parse(statusText).status).toBe('cancelled')

    // The original import call itself must eventually settle as an
    // error (it never got the write it asked for) -- awaited last since
    // it may still be inside its own courtesy window.
    const finalImport = await importResultPromise
    expect(finalImport.isError, 'a cancelled import must return an error result to the original caller').toBeTruthy()
  } finally {
    await client.close()
    await cleanupWorkflow(page, label)
    await restoreMCPWriteDefaults(page)
  }
})

// The phantom-1 repro (docs/goals/0026 item 5's own bug report): before
// this fix, ResolveMCPWrite never fired the pending-changed signal at
// all, so denying a parked write from Review left the sidebar badge
// stuck on a phantom count against an already-empty queue. Denying (not
// cancelling) is the exact regression case.
test('badge count drops on deny without any other event (phantom-1 repro)', async ({ page }, testInfo) => {
  const label = 'E2E MCP write deny badge source'
  await enableMCPWritesWithApprovalRequired(page)
  await createSourceWorkflow(page, label)

  const client = await connectMCPClient(testInfo.parallelIndex)
  try {
    const sourceId = await findWorkflowIdByLabel(client, label)
    const exported = await exportWorkflowViaMCP(client, sourceId)
    const importResultPromise = client.callTool({ name: 'import_workflow', arguments: { json: exported } })

    await page.getByRole('link', { name: 'Review' }).click()
    const item = page.getByTestId('review-mcp-write-item').first()
    await expect(item).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('review-pending-count')).toHaveText('1', { timeout: 10_000 })

    await item.getByTestId('review-mcp-write-deny').click()
    await expect(page.getByTestId('review-mcp-write-item')).toHaveCount(0, { timeout: 10_000 })
    // The regression this test locks in: the badge must clear on its
    // own, driven only by the deny's own emitted event -- no page
    // reload, no navigation away and back.
    await expect(page.getByTestId('review-pending-count')).toHaveCount(0, { timeout: 10_000 })

    // docs/goals/0026 item 6: the denied write now surfaces in Review's
    // own Recently-resolved section (the durable 24h outcome record),
    // not just session-only Activity -- distinct PlugIcon identity, not
    // clickable like a run row.
    const resolved = page.locator('[data-testid="inventory-row"][data-entity="mcpwrite"]').first()
    await expect(resolved).toBeVisible({ timeout: 10_000 })
    await expect(resolved.getByTestId('inventory-row-description')).toHaveText('denied')

    const out = await importResultPromise
    expect(out.isError).toBeTruthy()
  } finally {
    await client.close()
    await cleanupWorkflow(page, label)
    await restoreMCPWriteDefaults(page)
  }
})

// docs/goals/0026 item 7: an MCP-write Activity row is no longer
// action-dead -- it's expandable (the existing canExpand/result
// mechanism, ActivityView.tsx) and, when the gated tool named an
// existing workflow (update_workflow does; import_workflow doesn't --
// it mints a new one), carries a jump-to-workflow hover preview, the
// same WorkflowHoverPreview icon a run row already gets.
test('a denied MCP write appears in Activity, expandable, with a jump-to-workflow preview', async ({ page }, testInfo) => {
  const label = 'E2E MCP write activity source'
  await enableMCPWritesWithApprovalRequired(page)
  await createSourceWorkflow(page, label)

  const client = await connectMCPClient(testInfo.parallelIndex)
  try {
    const sourceId = await findWorkflowIdByLabel(client, label)
    const exported = await exportWorkflowViaMCP(client, sourceId)
    // update_workflow (unlike import_workflow) names an EXISTING target
    // workflow in its own args -- the case this affordance exists for.
    const updateResultPromise = client.callTool({ name: 'update_workflow', arguments: { id: sourceId, json: exported } })

    await page.getByRole('link', { name: 'Review' }).click()
    const item = page.getByTestId('review-mcp-write-item').first()
    await expect(item).toBeVisible({ timeout: 15_000 })
    await item.getByTestId('review-mcp-write-deny').click()
    await expect(page.getByTestId('review-mcp-write-item')).toHaveCount(0, { timeout: 10_000 })

    await page.getByRole('link', { name: 'Activity' }).click()
    const row = page.getByTestId('activity-row').filter({ hasText: 'UPDATE workflow' }).first()
    await expect(row).toBeVisible({ timeout: 10_000 })

    // Jump-to-workflow: the hover-preview anchor only renders when
    // entry.workflowID is set (WorkflowHoverPreview, same mechanism a
    // run row already uses) -- update_workflow named sourceId, so it's
    // present here.
    await expect(row.getByTestId('workflow-hover-anchor')).toBeVisible()

    // Expandable: clicking the row opens its detail panel with a real
    // result (the denial reason), the existing canExpand mechanism.
    await row.click()
    await expect(page.getByTestId('activity-detail')).toBeVisible({ timeout: 5_000 })

    const out = await updateResultPromise
    expect(out.isError).toBeTruthy()
  } finally {
    await client.close()
    await cleanupWorkflow(page, label)
    await restoreMCPWriteDefaults(page)
  }
})
