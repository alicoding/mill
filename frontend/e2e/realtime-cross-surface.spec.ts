import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/server'
import { connectMCPClient } from './mcpTestClient'
import { clickRowAction } from './inventoryRow'

// Goal 0017's flagship scenario, direct from the audit's own root
// cause: before this goal, ONLY mcpsvc emitted mill-data-changed --
// ConfigureService/CompositionService/GuardrailService emitted
// NOTHING, so a direct-UI or MCP-authored mutation never reached an
// already-open OTHER surface (only the exact tab that made the change
// ever refreshed itself, via its own local refetch call). This spec
// proves the fix at the two surfaces the audit named as the P0s:
// Configure's inventories (list/mcpserver were actively MISROUTED to
// refreshRequests()+refreshWorkflows(), App.tsx:242-244 before the
// fix) and a canvas entity picker seeing a workflow created elsewhere.

// Normalizes to write-gate ON + per-write approval OFF (unattended) --
// same local helper canvas-live-sync.spec.ts already uses (kept local
// there too, not promoted to mcpTestClient.ts, since that module's own
// enableMCPWritesWithApprovalRequired deliberately leaves approval ON
// for specs that want to exercise the approval banner instead).
async function enableUnattendedMCPWrites(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('link', { name: 'Settings' }).click()
  const writeCheckbox = page.getByTestId('mcp-write-enabled-checkbox')
  await expect(writeCheckbox).toBeEnabled()
  if (!(await writeCheckbox.isChecked())) {
    await writeCheckbox.click()
    await expect(writeCheckbox).toBeChecked()
  }
  const approvalCheckbox = page.getByTestId('mcp-write-approval-checkbox')
  await expect(approvalCheckbox).toBeEnabled()
  if (await approvalCheckbox.isChecked()) {
    await approvalCheckbox.click()
    await expect(approvalCheckbox).not.toBeChecked()
  }
}

async function restoreMCPWriteDefaults(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('link', { name: 'Settings' }).click()
  const approvalCheckbox = page.getByTestId('mcp-write-approval-checkbox')
  if (await approvalCheckbox.count() && !(await approvalCheckbox.isChecked())) {
    await approvalCheckbox.click()
    await expect(approvalCheckbox).toBeChecked()
  }
  const writeCheckbox = page.getByTestId('mcp-write-enabled-checkbox')
  if (await writeCheckbox.isChecked()) {
    await writeCheckbox.click()
    await expect(writeCheckbox).not.toBeChecked()
  }
}

test('Configure > Lists open: an MCP-authored import_list appears live, no reload (P0-2/P1-1)', async ({ page }, testInfo) => {
  await enableUnattendedMCPWrites(page)

  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  await expect(page.getByTestId('configure-lists')).toBeVisible()

  const label = 'E2E cross-surface list'
  const row = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText(label, { exact: true }) })
  await expect(row).toHaveCount(0)

  const client = await connectMCPClient(testInfo.parallelIndex)
  try {
    const result = await client.callTool({
      name: 'import_list',
      arguments: { json: JSON.stringify({ label, description: '', columns: [{ Key: 'k', Label: 'K', Type: 'text' }] }) },
    })
    if (result.isError) throw new Error(`import_list failed: ${JSON.stringify(result.content)}`)

    // No page.reload() -- ConfigureLists.tsx now reads the shared
    // configureEntityStore (shared/configureEntityStore.ts), which
    // App.tsx's mill-data-changed{entity:"list"} handler refreshes.
    // Before the fix, 'list' routed to refreshRequests()+
    // refreshWorkflows() -- neither of which touches this page's own
    // (then-local) state at all, so this row would never have appeared
    // without navigating away and back.
    await expect(row).toBeVisible({ timeout: 10_000 })
  } finally {
    await client.close()
  }

  await clickRowAction(page, row, 'Delete')
  await restoreMCPWriteDefaults(page)
})

test('a direct-UI workflow create in one window reaches a canvas picker open in another (P0-1)', async ({ page }) => {
  // Two real pages against the SAME worker server -- the actual "two
  // open surfaces" the goal names, not one page simulating it. Neither
  // one drives the other; both independently subscribe to the same
  // backend's mill-data-changed broadcast.
  const page2 = await page.context().newPage()
  try {
    await page.goto('/')
    await page.getByRole('link', { name: 'Configure' }).click()
    await page.getByRole('tab', { name: 'Attributes' }).click()
    const select = page.getByTestId('attributes-workflow-select')
    await expect(select).toBeVisible()

    const label = 'E2E cross-surface workflow'
    await expect(select.locator('option', { hasText: label })).toHaveCount(0)

    // A genuinely direct-UI create (the Workflows page's own "New
    // workflow" button + Save, no MCP involved at all) on the SECOND
    // page -- proves CompositionService.CreateWorkflow's own new
    // dataevent.Emit call (compositionservice.go), not mcpsvc's.
    await page2.goto('/')
    await page2.getByRole('link', { name: 'Workflows' }).click()
    await page2.getByTestId('new-workflow').click()
    await page2.locator('[role="tabpanel"]:not([hidden])').last().getByLabel('Label').fill(label)
    await page2.locator('[role="tabpanel"]:not([hidden])').last().getByTestId('save-workflow').click()

    // No page.reload() on page (the first page/window) -- ConfigureAttributes.tsx
    // now reads shared/store.ts's workflows store, refreshed by
    // App.tsx's mill-data-changed{entity:"workflow"} handler.
    await expect(select.locator('option', { hasText: label })).toHaveCount(1, { timeout: 10_000 })

    await page2.getByRole('link', { name: 'Workflows' }).click()
    const row = page2.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page2.getByText(label, { exact: true }) })
    await clickRowAction(page2, row, 'Delete')
  } finally {
    await page2.close()
  }
})
