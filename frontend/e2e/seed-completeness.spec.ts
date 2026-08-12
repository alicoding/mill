import { test, expect } from './fixtures/server'

// docs/goals/0010: proves the new seeded artifacts (a List, an MCP
// Server, and their workflows) are actually reachable and correct
// through the real live app -- the e2e half of "the seed IS the
// proof" (.claude/rules/testing.md), complementing the Go-level tests
// that already prove each seed's execution semantics against real
// DBOS/a real in-memory MCP transport.
//
// The MCP echo workflow's own node is deliberately never clicked open
// here: MCPToolArgsEditor.tsx fetches the server's real tool list
// (ConfigureService.ListMCPServerTools) the moment its Inspector
// mounts, which would spawn a real `npx` subprocess against the
// network -- exactly what item 5 says this suite must not do. This
// spec proves presence/config from the OUTSIDE instead: the Configure
// row's own description already shows the real command/args, and the
// canvas node card's own label is visible without ever selecting it.
//
// Nothing here creates/deletes data -- every artifact asserted on is a
// permanent seed, not a per-test fixture, so there's nothing to clean
// up (same reasoning request-builtin-examples.spec.ts's own header
// comment already gives).

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(label, { exact: true }) })
}

function activePanel(page: import('@playwright/test').Page) {
  return page.locator('[role="tabpanel"]:not([hidden])').last()
}

test('Seeded List "Example: Country codes" is present, built-in-badged, with its real entries', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()

  const row = page.locator('[data-testid="inventory-row"][data-entity="list"]').filter({ has: page.getByText('Example: Country codes', { exact: true }) })
  await expect(row).toBeVisible()
  await expect(row.getByText('built-in', { exact: true })).toBeVisible()
  // docs/goals/0011-lists-maturation.md: the seed grew typed
  // code/name columns + 5 rows (4 Active + 1 deliberately Expired),
  // replacing the old flat key/value "N entries" description.
  await expect(row).toContainText('2 columns, 5 rows')
})

test('Seeded MCP Server "Example: Reference server (npx)" is present, built-in-badged, pointed at the real reference server', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'MCP Servers' }).click()

  const row = page.locator('[data-testid="inventory-row"][data-entity="mcpserver"]').filter({ has: page.getByText('Example: Reference server (npx)', { exact: true }) })
  await expect(row).toBeVisible()
  await expect(row.getByText('built-in', { exact: true })).toBeVisible()
  // The row's own description is the real Command + Args -- proof of
  // config without connecting to the server (ListMCPServerTools is
  // never called here).
  await expect(row).toContainText('npx -y @modelcontextprotocol/server-everything')
})

test('Example: Country code lookup runs a real match through the seeded List', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const row = workflowRow(page, 'Example: Country code lookup')
  await expect(row).toBeVisible()
  await row.click()
  await expect(activePanel(page).locator('.react-flow__node').first()).toBeVisible()

  await activePanel(page).getByTestId('canvas-run').click()

  // The workflow declares 'code'/'countryName' Attributes -- Run opens
  // the test-input dialog (docs/adr/0008). US is a real entry in the
  // seeded List.
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Code').fill('US')
  await dialog.getByRole('button', { name: 'Run' }).click()

  const bar = activePanel(page).getByTestId('current-step-bar')
  await expect(bar).toContainText('SUCCESS', { timeout: 15_000 })
})

test('Example: Country lookup (search) runs a real exact match through list-search', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const row = workflowRow(page, 'Example: Country lookup (search)')
  await expect(row).toBeVisible()
  await row.click()
  await expect(activePanel(page).locator('.react-flow__node').first()).toBeVisible()

  await activePanel(page).getByTestId('canvas-run').click()

  // The workflow declares 'code'/'searchResult' Attributes -- only
  // 'code' matters for this run (list-search always overwrites
  // 'searchResult' with its own typed result, docs/goals/0011).
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Code').fill('US')
  await dialog.getByRole('button', { name: 'Run' }).click()

  const bar = activePanel(page).getByTestId('current-step-bar')
  await expect(bar).toContainText('SUCCESS', { timeout: 15_000 })
})

test('Example: MCP echo call workflow is present with the real mcp-tool-call node on canvas', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const row = workflowRow(page, 'Example: MCP echo call')
  await expect(row).toBeVisible()
  await row.click()

  // Node cards render their NodeType label without being selected --
  // this deliberately never clicks the mcp-tool-call node itself (see
  // this file's header comment for why: selecting it would trigger a
  // real ListMCPServerTools call against the seeded server, spawning a
  // live npx subprocess).
  const nodes = activePanel(page).locator('.react-flow__node')
  await expect(nodes).toHaveCount(2)
  await expect(nodes.filter({ hasText: 'MCP: tool call' })).toBeVisible()
})

test('Example: Disabled filesystem watch workflow is present and ships disabled', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const row = workflowRow(page, 'Example: Disabled filesystem watch')
  await expect(row).toBeVisible()
  await expect(row.getByText('disabled', { exact: true })).toBeVisible()
})

// docs/SPEC.md §5/§8 (save-page capture floor + clipboard inspector):
// presence-only, same reasoning as the rest of this file -- these two
// new seeds' real execution semantics are proven at the Go layer
// (composition's captureclipboardinfo_test.go/capturefile_test.go/
// processextracthtml_test.go, triggersvc's
// TestSeededSavedPageToMarkdown_FiresRealWorkflowAndExtractsMainContent),
// this just confirms they're actually reachable through the live app.

test('Example: Clipboard inspector workflow is present with the real capture-clipboard-info node on canvas', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const row = workflowRow(page, 'Example: Clipboard inspector')
  await expect(row).toBeVisible()
  await row.click()

  const nodes = activePanel(page).locator('.react-flow__node')
  await expect(nodes).toHaveCount(2)
  await expect(nodes.filter({ hasText: 'Capture: clipboard info' })).toBeVisible()
})

test('Example: Saved page to Markdown workflow is present and ships disabled', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const row = workflowRow(page, 'Example: Saved page → Markdown')
  await expect(row).toBeVisible()
  await expect(row.getByText('disabled', { exact: true })).toBeVisible()
})
