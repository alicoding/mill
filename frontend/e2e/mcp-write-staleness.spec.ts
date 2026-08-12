import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import {
  backdatePendingMCPWrite, connectMCPClient, exportWorkflowViaMCP, findWorkflowIdByLabel,
  enableMCPWritesWithApprovalRequired, restoreMCPWriteDefaults,
} from './mcpTestClient'

// docs/goals/0026 item 2: a stale pending item must visibly communicate
// its age -- fresh (<15m) renders as-is, older gets emphasis + "expires
// in Nh". Exercised on a real parked MCP write, backdated via
// SettingsService.DebugBackdatePendingMCPWrite (an e2e-only knob,
// millmcpservice_approval_query.go's own doc comment explains why an
// external settings-file edit can't do this against a LIVE server)
// rather than sleeping 20 real minutes.

function workflowRow(page: Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

test('a backdated pending MCP write renders age emphasis + expiry text in Review, the banner, and the approval prompt', async ({ page }, testInfo) => {
  const label = 'E2E MCP write staleness source'
  await enableMCPWritesWithApprovalRequired(page)

  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await page.locator('[role="tabpanel"]:not([hidden])').last().getByLabel('Label').fill(label)
  await page.locator('[role="tabpanel"]:not([hidden])').last().getByTestId('save-workflow').click()
  await expect(workflowRow(page, label)).toBeVisible()

  const client = await connectMCPClient(testInfo.parallelIndex)
  try {
    const sourceId = await findWorkflowIdByLabel(client, label)
    const exported = await exportWorkflowViaMCP(client, sourceId)
    const importResultPromise = client.callTool({ name: 'import_workflow', arguments: { json: exported } })

    await page.getByRole('link', { name: 'Review' }).click()
    const item = page.getByTestId('review-mcp-write-item').first()
    await expect(item).toBeVisible({ timeout: 15_000 })

    // Fresh: no age emphasis yet, just the plain relative-time render
    // (StalenessBadge's own 'fresh' branch -- no data-age-tier attribute).
    await expect(item.getByTestId('review-mcp-write-age')).not.toHaveAttribute('data-age-tier', 'aging')

    const id = await item.getAttribute('data-mcp-write-id')
    expect(id).toBeTruthy()

    // Backdate 20 minutes -- past item 2's 15-minute bar, well short of
    // the 24h expiry (renders "expires in 23h").
    await backdatePendingMCPWrite(page, id as string, 20)

    // Review's own row: age emphasis + "expires in Nh".
    await expect(item.getByTestId('review-mcp-write-age')).toHaveAttribute('data-age-tier', 'aging', { timeout: 10_000 })
    await expect(item).toContainText(/expires in \d+h/)

    // MCPWriteApprovals' banner (App.tsx's global chrome, visible on
    // every page) shows the same emphasis for the same write.
    const bannerAge = page.getByTestId('mcp-write-approval-age')
    await expect(bannerAge).toHaveAttribute('data-age-tier', 'aging', { timeout: 10_000 })

    // The floating approval prompt's own route (ADR-0033's mechanism,
    // headlessly reachable per approval-prompt.spec.ts's own precedent)
    // shows it too. A fresh cross-document navigation (not a
    // same-document hash change from the already-loaded page) is
    // required to actually mount ApprovalPromptApp's own tree --
    // approval-prompt.spec.ts's own precedent/comment for this.
    await page.goto('about:blank')
    await page.goto('/#/approvalprompt')
    const promptAge = page.getByTestId('approval-prompt-age')
    await expect(promptAge).toHaveAttribute('data-age-tier', 'aging', { timeout: 10_000 })

    // No auto-dismiss (docs/goals/0026 item 2's own "no auto-dismiss"
    // rule): the item is still there, still actionable, staleness is
    // presentation only.
    await expect(page.getByTestId('approval-prompt-description')).toBeVisible()

    await page.goto('/')
    await page.getByRole('link', { name: 'Review' }).click()
    await page.getByTestId('review-mcp-write-item').first().getByTestId('review-mcp-write-deny').click()
    await expect(page.getByTestId('review-mcp-write-item')).toHaveCount(0, { timeout: 10_000 })

    const out = await importResultPromise
    expect(out.isError).toBeTruthy()
  } finally {
    await client.close()
    const row = workflowRow(page, label)
    if (await row.count() > 0) {
      await clickRowAction(page, row.first(), 'Delete')
      await expect(workflowRow(page, label)).toHaveCount(0)
    }
    await restoreMCPWriteDefaults(page)
  }
})
