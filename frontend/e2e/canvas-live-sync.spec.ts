import type { Page } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { MCP_BASE_PORT, test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import { workflowRow, activePanel } from './fixtures/canvas'

// Live canvas sync for external (MCP) activity (docs/SPEC.md §1's
// realtime lock, applied to authoring): an open workflow editor must
// react to an external MCP author's definition edits without a manual
// reload -- App.tsx's own `mill-data-changed` handler (App.tsx:229)
// only ever refreshes the Workflows LIST, never a mounted canvas's own
// nodes/edges/undo history (useCanvasLiveSync.ts). Drives a REAL MCP
// client over real HTTP against Mill's own MCP server (millmcpservice.go),
// the same "test against something real" bar mcp-tool-editor.spec.ts
// already sets for the opposite direction (Mill as MCP client) -- here
// Mill is the MCP SERVER and this spec is the external author.
//
// Each Playwright worker already gets its own MILL_MCP_ADDR listener
// (e2e/fixtures/server.ts's workerServer fixture) -- MCP_BASE_PORT is
// exported from there specifically so this spec can compute the same
// worker's own MCP port without spawning a second listener.

async function connectMCPClient(workerIndex: number): Promise<Client> {
  const client = new Client({ name: 'canvas-live-sync-e2e', version: '0.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${MCP_BASE_PORT + workerIndex}`))
  await client.connect(transport)
  return client
}

interface WorkflowIndexEntry {
  id: string
  label: string
  description?: string
}

async function findWorkflowIdByLabel(client: Client, label: string): Promise<string> {
  const result = await client.readResource({ uri: 'mill://workflows' })
  const first = result.contents[0]
  const text = 'text' in first ? first.text : ''
  const list = JSON.parse(text) as WorkflowIndexEntry[]
  const found = list.find((w) => w.label === label)
  if (!found) throw new Error(`workflow "${label}" not found in mill://workflows: ${text}`)
  return found.id
}

async function updateWorkflowViaMCP(client: Client, id: string, definitionJSON: string): Promise<void> {
  const result = await client.callTool({ name: 'update_workflow', arguments: { id, json: definitionJSON } })
  if (result.isError) {
    const first = result.content[0]
    const text = first && 'text' in first ? first.text : ''
    throw new Error(`update_workflow failed: ${text}`)
  }
}

// A definition carrying a second, distinctive node (process-inject-text)
// downstream of the always-present trigger -- proves a real graph
// reload, not just a label repaint, matching hot-exit.spec.ts's own
// "2 nodes" assertion style for the same underlying graph shape.
function twoNodeDefinition(label: string, marker: string): string {
  return JSON.stringify({
    label,
    description: '',
    nodes: [
      { ID: 't', NodeTypeID: 'trigger-manual' },
      { ID: 'p', NodeTypeID: 'process-inject-text', Config: { text: marker, placement: 'append' } },
    ],
    edges: [{ ID: 'e1', Source: 't', Target: 'p' }],
    attributes: [],
  })
}

// Normalizes to write-gate ON + per-write approval OFF (unattended),
// same "normalize first, since the shared e2e settings file could carry
// a previous run's value" discipline settings.spec.ts's own MCP test
// already established -- this spec needs writes to actually go
// through, not park in the MCPWriteApprovals UI.
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

// Leaves the shared e2e settings file the way a fresh install would
// look (.claude/rules/testing.md's cleanup discipline) -- write gate
// off, approval required back on -- so a later spec file sharing this
// worker never inherits an unattended-MCP-writes instance.
async function restoreMCPWriteDefaults(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('link', { name: 'Settings' }).click()
  const approvalCheckbox = page.getByTestId('mcp-write-approval-checkbox')
  if (await approvalCheckbox.count()) {
    if (!(await approvalCheckbox.isChecked())) {
      await approvalCheckbox.click()
      await expect(approvalCheckbox).toBeChecked()
    }
  }
  const writeCheckbox = page.getByTestId('mcp-write-enabled-checkbox')
  if (await writeCheckbox.isChecked()) {
    await writeCheckbox.click()
    await expect(writeCheckbox).not.toBeChecked()
  }
}

// Closes the open editor tab, deletes the named workflow row, and
// restores the shared MCP-write settings -- shared by both tests below,
// each wrapping this in an outer try/finally so it ALWAYS runs, even
// when an assertion above throws. Before this, both tests only ran
// their cleanup on the happy path: a failed assertion inside the MCP
// round-trip (this file's own live race, fixed in useCanvasLiveSync.ts)
// left "E2E live sync clean"/"dirty" undeleted AND unattended MCP
// writes still enabled for the rest of this worker's shard -- traced
// live as the mechanism behind a real cascade (this spec's own flake
// tripping configure-lists.spec.ts's "list-search node" test in the
// same shard-1 CI run, docs/goals/BACKLOG.md Standing #1). Kept as
// cleanup hardening regardless of the race fix -- any OTHER future
// assertion failure in either test would hit the exact same cascade
// without it.
async function cleanupWorkflow(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Close tab' }).last().click()
  await clickRowAction(page, workflowRow(page, label), 'Delete')
  await restoreMCPWriteDefaults(page)
}

test('clean canvas: an external MCP update_workflow redraws the open editor live, no reload', async ({ page }, testInfo) => {
  await enableUnattendedMCPWrites(page)

  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByLabel('Label').fill('E2E live sync clean')
  await activePanel(page).getByTestId('save-workflow').click()

  const row = workflowRow(page, 'E2E live sync clean')
  await expect(row).toBeVisible()
  await row.click()
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(1)

  try {
    const client = await connectMCPClient(testInfo.parallelIndex)
    try {
      const workflowId = await findWorkflowIdByLabel(client, 'E2E live sync clean')
      await updateWorkflowViaMCP(client, workflowId, twoNodeDefinition('E2E live sync clean', 'clean-path marker'))

      // No page.reload(), no re-navigation -- the redraw has to happen
      // purely from the `mill-data-changed` event this canvas subscribed
      // to (useCanvasLiveSync.ts).
      await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(2, { timeout: 10_000 })
      await expect(activePanel(page).locator('.react-flow__node').filter({ hasText: 'Add text' })).toBeVisible()
      await expect(page.getByTestId('external-change-banner')).toHaveCount(0)
    } finally {
      await client.close()
    }
  } finally {
    await cleanupWorkflow(page, 'E2E live sync clean')
  }
})

test('dirty canvas: external MCP edit shows a banner, keeps the local edit, and Reload applies the fresh definition', async ({ page }, testInfo) => {
  await enableUnattendedMCPWrites(page)

  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByLabel('Label').fill('E2E live sync dirty')
  await activePanel(page).getByTestId('save-workflow').click()

  const row = workflowRow(page, 'E2E live sync dirty')
  await expect(row).toBeVisible()
  await row.click()
  // Row click opens VIEW mode (docs/goals/0022) -- a "dirty canvas"
  // requires actually editing it, which needs the Edit switch first
  // (Description is read-only in view mode).
  await activePanel(page).getByTestId('edit-workflow').click()

  // A real, unsaved local edit -- the Description field, so it doesn't
  // touch the node graph itself (isolating what this test is actually
  // proving: the local edit survives, independent of node count).
  await activePanel(page).getByTestId('toggle-description').click()
  await activePanel(page).getByLabel('Description').fill('local unsaved edit')

  try {
    const client = await connectMCPClient(testInfo.parallelIndex)
    try {
      const workflowId = await findWorkflowIdByLabel(client, 'E2E live sync dirty')
      await updateWorkflowViaMCP(client, workflowId, twoNodeDefinition('E2E live sync dirty', 'dirty-path marker'))

      const banner = page.getByTestId('external-change-banner')
      await expect(banner).toBeVisible({ timeout: 10_000 })

      // The local edit is untouched -- the external change was NOT
      // applied automatically while dirty.
      await expect(activePanel(page).getByLabel('Description')).toHaveValue('local unsaved edit')
      await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(1)

      await banner.getByRole('button', { name: 'Reload' }).click()

      // Reload discards the local draft and loads the fresh (external)
      // definition.
      await expect(banner).toHaveCount(0)
      await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(2)
      await expect(activePanel(page).locator('.react-flow__node').filter({ hasText: 'Add text' })).toBeVisible()
      await expect(activePanel(page).getByLabel('Description')).toHaveValue('')
    } finally {
      await client.close()
    }
  } finally {
    await cleanupWorkflow(page, 'E2E live sync dirty')
  }
})
