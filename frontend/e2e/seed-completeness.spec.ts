import { test, expect } from './fixtures/server'
import { workflowRow, activePanel } from './fixtures/canvas'
import { expandExamples } from './inventoryRow'
import { openConfigureKind } from './fixtures/configureNav'
import { waitForRunTerminal } from './fixtures/runTerminal'

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

test('Seeded List "Country codes" is present, built-in-badged, with its real entries', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'Lists')

  const row = page.locator('[data-testid="inventory-row"][data-entity="list"]').filter({ has: page.getByText('Country codes', { exact: true }) })
  await expect(row).toBeVisible()
  await expect(row.getByText('built-in', { exact: true })).toBeVisible()
  // docs/goals/0011-lists-maturation.md: the seed grew typed
  // code/name columns + 5 rows (4 Active + 1 deliberately Expired),
  // replacing the old flat key/value "N entries" description. A third,
  // Deprecated column (docs/adr/0040 decision 2's own seeded proof)
  // brought the column count to 3.
  await expect(row).toContainText('3 columns, 5 rows')
})

test('Seeded MCP Server "Example: Reference server (npx)" is present, built-in-badged, pointed at the real reference server', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'MCP Servers')

  const row = page.locator('[data-testid="inventory-row"][data-entity="mcpserver"]').filter({ has: page.getByText('Example: Reference server (npx)', { exact: true }) })
  await expect(row).toBeVisible()
  await expect(row.getByText('built-in', { exact: true })).toBeVisible()
  // The row's own description is the real Command + Args -- proof of
  // config without connecting to the server (ListMCPServerTools is
  // never called here).
  await expect(row).toContainText('npx -y @modelcontextprotocol/server-everything')
})

test('Look up a client country runs a real match through the seeded List', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  await expandExamples(page)
  const row = workflowRow(page, 'Look up a client country')
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

  const bar = activePanel(page).getByTestId('run-state-dock')
  await waitForRunTerminal(bar)
})

test('Search client countries runs a real exact match through list-search', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const row = workflowRow(page, 'Search client countries')
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

  const bar = activePanel(page).getByTestId('run-state-dock')
  await waitForRunTerminal(bar)
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
  await expect(nodes.filter({ hasText: 'Call an MCP tool' })).toBeVisible()
})

test('Example: Disabled filesystem watch workflow is present and ships disabled', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const row = workflowRow(page, 'Example: Disabled filesystem watch')
  await expect(row).toBeVisible()
  await expect(row.getByText('disabled', { exact: true })).toBeVisible()
})

// docs/goals/0031-ai-node-family.md: the AI node family's own seeded
// proof, e2e half (the Go proof runs it end-to-end against an httptest
// fixture -- executionsvc.TestSeededAISummarizeExample_
// RunsEndToEndAgainstFixtureEndpoint). Never clicks Run here: the
// seeded AIProvider points at a real localhost:11434 Ollama endpoint
// this suite has no business depending on being present -- same
// "prove presence/config from the outside" posture the MCP Server test
// above already establishes for the identical reason.
test('Seeded AI provider "Local Ollama (localhost:11434)" is present, built-in-badged', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'AI Providers')

  const row = page.locator('[data-testid="inventory-row"][data-entity="aiprovider"]').filter({ has: page.getByText('Local Ollama (localhost:11434)', { exact: true }) })
  await expect(row).toBeVisible()
  await expect(row.getByText('built-in', { exact: true })).toBeVisible()
  await expect(row).toContainText('http://localhost:11434')
})

test('Summarize a client email workflow is present with the real process-ai-completion node, ships disabled', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const row = workflowRow(page, 'Summarize a client email')
  await expect(row).toBeVisible()
  await expect(row.getByText('disabled', { exact: true })).toBeVisible()
  await row.click()

  const nodes = activePanel(page).locator('.react-flow__node')
  await expect(nodes).toHaveCount(3)
  await expect(nodes.filter({ hasText: 'Generate with AI' })).toBeVisible()
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
  await expect(nodes.filter({ hasText: 'Inspect clipboard' })).toBeVisible()
})

test('Example: Saved page to Markdown workflow is present and ships disabled', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const row = workflowRow(page, 'Saved client page → Markdown')
  await expect(row).toBeVisible()
  await expect(row.getByText('disabled', { exact: true })).toBeVisible()
})

// docs/adr/0035: the composed replacement for ForwardPendingApproval's
// deleted private send path -- real execution semantics (the decision-
// parked emission, the loop rule, run-completed firing for both RunKinds)
// are proven at the Go layer (triggersvc's systemevent_seed_test.go);
// this confirms the seed is actually reachable through the live app and
// shows its real trigger-system-event label, same presence-only bar
// every other real-event-driven seed above already sets.
test('Forward approvals to the sponsor workflow is present, disabled, with the real trigger-system-event node on canvas', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const row = workflowRow(page, 'Forward approvals to the sponsor')
  await expect(row).toBeVisible()
  await expect(row.getByText('disabled', { exact: true })).toBeVisible()
  await row.click()

  const nodes = activePanel(page).locator('.react-flow__node')
  await expect(nodes).toHaveCount(2)
  await expect(nodes.filter({ hasText: 'System event' })).toBeVisible()
})

// docs/goals/0031-ai-node-family.md: THE decisioning composition --
// Classify with AI writes a category Attribute, Branch routes on it. Never
// clicks Run here for the same "no real Ollama in CI" reasoning the
// Generate with AI seed test above documents; the Go proof
// (executionsvc.TestSeededAIClassifyBranchExample_UrgentRoutesToUrgentBranch/
// _NormalRoutesToNormalBranch) runs both branch outcomes end to end
// against an httptest fixture.
test('Triage a client email workflow is present with the real process-ai-classify + Branch nodes, ships disabled', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const row = workflowRow(page, 'Triage a client email')
  await expect(row).toBeVisible()
  await expect(row.getByText('disabled', { exact: true })).toBeVisible()
  await row.click()

  const nodes = activePanel(page).locator('.react-flow__node')
  await expect(nodes).toHaveCount(6)
  await expect(nodes.filter({ hasText: 'Classify with AI' })).toBeVisible()
})

// docs/goals/0066, ADR-0035/0038: the Atlas<->Workflows integration's
// own e2e proof. Ships unpublished (never auto-arms, same safe-by-
// default posture "Example: Disabled filesystem watch" gives a real-
// event trigger) -- presence/config only, same reasoning as every
// other real-event-driven seed above; the trigger's own fire + cycle
// guard are proven end to end at the Go layer
// (triggersvc.TestSeededCardIntakeExample_TriggerUpdatesOwnCardAndDoesNotLoop).
test('Client request intake workflow is present with the real trigger-atlas-card + Update Atlas card nodes on canvas', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const row = workflowRow(page, 'Client request intake')
  await expect(row).toBeVisible()
  await row.click()

  const nodes = activePanel(page).locator('.react-flow__node')
  await expect(nodes).toHaveCount(2)
  await expect(nodes.filter({ hasText: 'Atlas card changed' })).toBeVisible()
  await expect(nodes.filter({ hasText: 'Update Atlas card' })).toBeVisible()
})

// Manual-triggered and purely local (no clipboard, no network) --
// unlike the clipboard/AI/MCP seeds above, this one is safe to actually
// run here: proves the create -> find -> link chain through the real
// live app, not just presence.
test('Log a client request and its decision runs end to end through the real live app', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const row = workflowRow(page, 'Log a client request and its decision')
  await expect(row).toBeVisible()
  await row.click()
  await expect(activePanel(page).locator('.react-flow__node').first()).toBeVisible()

  await activePanel(page).getByTestId('canvas-run').click()

  const bar = activePanel(page).getByTestId('run-state-dock')
  await waitForRunTerminal(bar)
})
