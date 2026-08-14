import type { Page } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import {
  connectMCPClient, exportWorkflowViaMCP, findWorkflowIdByLabel, stripExportedID,
  enableMCPWritesWithApprovalRequired, restoreMCPWriteDefaults,
} from './mcpTestClient'

// Exercises the floating approval prompt's frontend at its hash route
// (/#/approvalprompt, docs/goals/0023-attention-escalation.md item 1,
// app/ApprovalPrompt.tsx) over real Go bindings (Wails3 server mode) --
// same "the route itself is fully e2e-able headlessly" reasoning
// quick-panel.spec.ts already established for the sibling second
// window (ADR-0033's mechanism, reused here). What's NOT headlessly
// verifiable is the WINDOW-LEVEL behavior around it (floating window
// level, the backend-triggered Show() on an away verdict, Escape via
// the native HideOnEscape option, the focus-yield mitigation) -- those
// belong in the manual-only registry (.claude/skills/run-mill/SKILL.md)
// per .claude/rules/testing.md's own "manual-only registry... never
// silently absent" requirement.

function workflowRow(page: Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

test('the approval prompt route renders standalone and shows nothing pending', async ({ page }) => {
  await page.goto('/#/approvalprompt')

  const prompt = page.getByTestId('approval-prompt')
  await expect(prompt).toBeVisible()
  await expect(page.getByTestId('approval-prompt-empty')).toBeVisible()

  // No sidebar/PageLayout chrome -- this is the dedicated minimal shell
  // (ApprovalPromptApp), not <App/>'s tree.
  await expect(page.getByRole('link', { name: 'Workflows' })).toHaveCount(0)
})

test('a parked MCP write shows in the approval prompt, and Approve resolves it', async ({ page }, testInfo) => {
  await enableMCPWritesWithApprovalRequired(page)

  // A source workflow to export/re-import (import always mints a new
  // ID -- the exact gated write this lifecycle protects).
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await page.locator('[role="tabpanel"]:not([hidden])').last().getByLabel('Label').fill('E2E approval prompt source')
  await page.locator('[role="tabpanel"]:not([hidden])').last().getByTestId('save-workflow').click()
  await expect(workflowRow(page, 'E2E approval prompt source')).toBeVisible()

  const client = await connectMCPClient(testInfo.parallelIndex)
  let importResultPromise: ReturnType<Client['callTool']>
  try {
    const sourceId = await findWorkflowIdByLabel(client, 'E2E approval prompt source')
    const exported = await exportWorkflowViaMCP(client, sourceId)

    // Fire the gated import -- parks as a durable pending record
    // (docs/adr/0032), independent of whether this specific browser
    // page happens to be watching for it.
    importResultPromise = client.callTool({ name: 'import_workflow', arguments: { json: stripExportedID(exported) } })

    // A fresh cross-document navigation to the approval prompt's own
    // route (not a same-document hash change from an already-loaded
    // page, same discipline quick-panel.spec.ts's own run-target test
    // uses) picks up the already-parked write on its first fetch.
    await page.goto('about:blank')
    await page.goto('/#/approvalprompt')

    const description = page.getByTestId('approval-prompt-description')
    await expect(description).toBeVisible({ timeout: 15_000 })
    await expect(description).toContainText('import a workflow')

    await page.getByTestId('approval-prompt-approve').click()

    // Resolved -- the prompt goes back to its empty state (no more
    // pending items), which is also what drives the real window's own
    // auto-hide (DismissApprovalPrompt).
    await expect(page.getByTestId('approval-prompt-empty')).toBeVisible({ timeout: 10_000 })

    // The write actually executed: a second workflow with the same
    // label now exists (import always mints a new ID, never overwrites).
    await page.goto('/')
    await page.getByRole('link', { name: 'Workflows' }).click()
    await expect(workflowRow(page, 'E2E approval prompt source')).toHaveCount(2, { timeout: 10_000 })

    const result = await importResultPromise
    if (result.isError) {
      throw new Error(`import_workflow ultimately errored after approval: ${JSON.stringify(result.content)}`)
    }
  } finally {
    await client.close()
  }

  // Cleanup: both minted workflows, one at a time (the DOM shifts as
  // each row disappears), and the settings toggle.
  let remaining = await workflowRow(page, 'E2E approval prompt source').count()
  while (remaining > 0) {
    await clickRowAction(page, workflowRow(page, 'E2E approval prompt source').first(), 'Delete')
    remaining -= 1
    await expect(workflowRow(page, 'E2E approval prompt source')).toHaveCount(remaining)
  }
  await restoreMCPWriteDefaults(page)
})
