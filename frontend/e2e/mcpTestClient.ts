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

// backdatePendingMCPWrite drives the e2e-only debug knob
// (SettingsService.DebugBackdatePendingMCPWrite, docs/goals/0026 item 2)
// directly over Wails3's own runtime call wire protocol, bypassing the
// generated bindings entirely -- page.evaluate can't `import` a
// production-bundled chunk by a stable path, and the generated
// bindings' own numeric method IDs (Call.ByID) are regenerated per
// `wails3 generate bindings` run, too fragile to hardcode in a test.
// The METHOD NAME form (Call.ByName, "package.Struct.Method") is the
// stable identifier Wails3 itself resolves bound methods by
// server-side (confirmed directly against @wailsio/runtime's own
// dist/calls.js + dist/runtime.js, and wails3's own bindings_test.go
// MethodName format) -- this replicates that exact wire shape via a
// plain POST, the same request the generated binding itself would send.
export async function backdatePendingMCPWrite(page: Page, id: string, ageMinutes: number): Promise<void> {
  const res = await page.request.post('/wails/runtime', {
    headers: { 'x-wails-client-id': 'e2e-test-knob', 'Content-Type': 'application/json' },
    data: {
      object: 0, // objectNames.Call
      method: 0, // CallBinding
      args: {
        'call-id': `e2e-backdate-${Date.now()}`,
        methodName: 'github.com/alicoding/mill/internal/services/settingssvc.SettingsService.DebugBackdatePendingMCPWrite',
        args: [id, ageMinutes],
      },
    },
  })
  if (!res.ok()) {
    throw new Error(`backdatePendingMCPWrite failed: ${res.status()} ${await res.text()}`)
  }
}

// mcpPort lets a dedicated-server spec (its own port pair, not the
// standard per-worker pool) pass its own computed port directly --
// defaults to the worker-pool formula every other caller already relies on.
export async function connectMCPClient(workerIndex: number, mcpPort?: number): Promise<Client> {
  const client = new Client({ name: 'mill-e2e', version: '0.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort ?? MCP_BASE_PORT + workerIndex}`))
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

// ADR-0036: export_workflow now always carries the source workflow's
// real id, so re-importing it unmodified updates that workflow in
// place rather than creating a second, independent one. Callers that
// want the create path (most of this suite's "import always mints a
// new ID" fixtures) strip it first via this helper.
export function stripExportedID(exported: string): string {
  const parsed = JSON.parse(exported) as Record<string, unknown>
  delete parsed.id
  return JSON.stringify(parsed)
}

// Writes ON, per-write approval left ON (the default) -- the shape most
// callers need, distinct from canvas-live-sync.spec.ts's own
// "unattended" helper which deliberately relaxes approval.
export async function enableMCPWritesWithApprovalRequired(page: Page): Promise<void> {
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
  await page.getByRole('link', { name: 'Settings' }).click()
  const writeCheckbox = page.getByTestId('mcp-write-enabled-checkbox')
  if (await writeCheckbox.isChecked()) {
    await writeCheckbox.click()
    await expect(writeCheckbox).not.toBeChecked()
  }
}
