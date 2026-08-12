import type { Page } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { MCP_BASE_PORT, expect } from './fixtures/server'

// Shared e2e helpers for driving Mill's real MCP server over HTTP
// (docs/adr/0025/0032) -- factored out of mcp-write-approval.spec.ts so
// a second spec needing a parked MCP write (the Review kind filter,
// docs/goals/0002 item 4) doesn't hand-roll a second copy. Not a
// *.spec.ts file itself -- Playwright only picks up files matching its
// own testMatch glob, same "plain helper module" shape as
// inventoryRow.ts.

export async function connectMCPClient(workerIndex: number): Promise<Client> {
  const client = new Client({ name: 'mill-e2e', version: '0.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${MCP_BASE_PORT + workerIndex}`))
  await client.connect(transport)
  return client
}

interface WorkflowIndexEntry {
  id: string
  label: string
}

export async function findWorkflowIdByLabel(client: Client, label: string): Promise<string> {
  const result = await client.readResource({ uri: 'mill://workflows' })
  const first = result.contents[0]
  const text = 'text' in first ? first.text : ''
  const list = JSON.parse(text as string) as WorkflowIndexEntry[]
  const found = list.find((w) => w.label === label)
  if (!found) throw new Error(`workflow "${label}" not found in mill://workflows: ${text}`)
  return found.id
}

export async function exportWorkflowViaMCP(client: Client, id: string): Promise<string> {
  const result = await client.callTool({ name: 'export_workflow', arguments: { id } })
  if (result.isError) throw new Error(`export_workflow failed: ${JSON.stringify(result.content)}`)
  const content = result.content as Array<{ type: string; text?: string }>
  return content[0]?.text ?? ''
}

// Writes ON, per-write approval left ON (the default) -- the shape most
// callers need, distinct from canvas-live-sync.spec.ts's own
// "unattended" helper which deliberately relaxes approval.
export async function enableMCPWritesWithApprovalRequired(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()
  const writeCheckbox = page.getByTestId('mcp-write-enabled-checkbox')
  await expect(writeCheckbox).toBeEnabled()
  if (!(await writeCheckbox.isChecked())) {
    await writeCheckbox.click()
    await expect(writeCheckbox).toBeChecked()
  }
  const approvalCheckbox = page.getByTestId('mcp-write-approval-checkbox')
  await expect(approvalCheckbox).toBeEnabled()
  if (!(await approvalCheckbox.isChecked())) {
    await approvalCheckbox.click()
    await expect(approvalCheckbox).toBeChecked()
  }
}

// Leaves the shared e2e settings file the way a fresh install would
// look (.claude/rules/testing.md's cleanup discipline): write gate off,
// approval required stays on either way.
export async function restoreMCPWriteDefaults(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()
  const writeCheckbox = page.getByTestId('mcp-write-enabled-checkbox')
  if (await writeCheckbox.isChecked()) {
    await writeCheckbox.click()
    await expect(writeCheckbox).not.toBeChecked()
  }
}
