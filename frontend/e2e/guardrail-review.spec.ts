import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  GUARDRAIL_REVIEW_MCP_BASE_PORT,
  GUARDRAIL_REVIEW_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import {
  connectMCPClient, enableMCPWritesWithApprovalRequired, exportWorkflowViaMCP,
  findWorkflowIdByLabel, restoreMCPWriteDefaults, stripExportedID,
} from './mcpTestClient'

// The Review queue half of the guardrail execution gate (docs/SPEC.md
// §8, ADR-0019/0022, docs/goals/0002-review-queue-maturation.md) --
// split out of guardrail.spec.ts once that file crossed the 500-line
// limit converting to this pattern. Same seed-is-the-proof discipline
// (.claude/rules/testing.md), driven through the seeded "Example:
// Approval-gated HTTP call" and "Example: Human review with input"
// workflows.
//
// Runs on its own dedicated server (fixtures/server.ts's
// GUARDRAIL_REVIEW_* ports), not the standard per-worker pool: these
// tests assert exact pending/resolved queue rows and kind-filter
// counts, which must never be contaminated by another spec cohabiting
// a shared worker's one server.

const GUARDED = 'Example: Approval-gated HTTP call'

interface SpawnedPage {
  server: SpawnedServer
  browser: Browser
  page: Page
  dir: string
}

async function openDedicatedServer(namePrefix: string, offset: number, idx: number): Promise<SpawnedPage> {
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-${namePrefix}-${idx}-`))
  const port = GUARDRAIL_REVIEW_SERVER_BASE_PORT + offset + idx
  const mcpPort = GUARDRAIL_REVIEW_MCP_BASE_PORT + offset + idx
  const browser = await chromium.launch()
  const server = await spawnMillServer({
    port, mcpPort,
    settingsPath: path.join(dir, 'settings.json'),
    executionDbPath: path.join(dir, 'execution.db'),
    backupDir: path.join(dir, 'backups'),
  })
  // baseURL on the context so shared helpers that navigate with a
  // relative path (e.g. mcpTestClient.ts's enableMCPWritesWithApprovalRequired)
  // resolve against this test's own dedicated server, not Playwright's
  // (unset, since this file never uses the standard workerServer fixture).
  const page = await browser.newPage({ baseURL: server.baseURL })
  return { server, browser, page, dir }
}

async function closeDedicatedServer(s: SpawnedPage): Promise<void> {
  await s.browser.close()
  await s.server.stop()
  rmSync(s.dir, { recursive: true, force: true })
}

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Review queue: a parked human-review run accepts typed input and resumes with it', async ({}, testInfo) => {
  const s = await openDedicatedServer('guardrail-review', 0, testInfo.parallelIndex)
  try {
    const { page } = s
    await page.goto(`${s.server.baseURL}/`)
    await page.getByRole('link', { name: 'Workflows' }).click()
    const seed = 'Example: Human review with input'
    const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(seed, { exact: true }) })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Run' }).click()

    // The seed declares a 'note' Attribute, so Run opens the test-input
    // dialog (docs/adr/0008) -- clear the generated value: providing the
    // note is the REVIEWER's job in this flow.
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Note').fill('')
    await dialog.getByRole('button', { name: 'Run' }).click()

    // The run parks; the Review queue (sidebar) lists it.
    await page.getByRole('link', { name: 'Review' }).click()
    const item = page.getByTestId('review-item').filter({ hasText: seed }).first()
    await expect(item).toBeVisible({ timeout: 10_000 })
    await expect(item).toContainText('Provide a note for this run, then approve')

    // Typed input: fill the workflow's declared 'note' Attribute, approve.
    await item.getByLabel('Note').fill('e2e reviewer note')
    await item.getByTestId('review-approve').click()
    await expect(page.getByTestId('review-item').filter({ hasText: seed })).toHaveCount(0, { timeout: 10_000 })

    // The resumed run carried the input through capture-attribute and the
    // ruleset: its durable history shows SUCCESS with the note as output.
    await page.getByRole('link', { name: 'Workflows' }).click()
    await row.click()
    await page.getByRole('tab', { name: 'Runs' }).click()
    await page.getByTestId('runs-table').locator('tbody tr').first().click()
    await expect(page.getByTestId('run-detail')).toContainText('e2e reviewer note', { timeout: 10_000 })
  } finally {
    await closeDedicatedServer(s)
  }
})

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Review queue: denying from the queue stops the run', async ({}, testInfo) => {
  const s = await openDedicatedServer('guardrail-review-deny', 10, testInfo.parallelIndex)
  try {
    const { page } = s
    await page.goto(`${s.server.baseURL}/`)
    await page.getByRole('link', { name: 'Workflows' }).click()
    const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(GUARDED, { exact: true }) })
    await row.getByRole('button', { name: 'Run' }).click()

    await page.getByRole('link', { name: 'Review' }).click()
    const item = page.getByTestId('review-item').filter({ hasText: GUARDED }).first()
    await expect(item).toBeVisible({ timeout: 10_000 })
    await item.getByTestId('review-deny').click()
    await expect(page.getByTestId('review-item').filter({ hasText: GUARDED })).toHaveCount(0, { timeout: 10_000 })
  } finally {
    await closeDedicatedServer(s)
  }
})

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Review queue shows the resolved outcome after a deny, filterable by workflow', async ({}, testInfo) => {
  const s = await openDedicatedServer('guardrail-review-filter', 20, testInfo.parallelIndex)
  try {
    const { page } = s
    await page.goto(`${s.server.baseURL}/`)
    await page.getByRole('link', { name: 'Workflows' }).click()
    const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(GUARDED, { exact: true }) })
    await row.getByRole('button', { name: 'Run' }).click()

    await page.getByRole('link', { name: 'Review' }).click()
    const item = page.getByTestId('review-item').filter({ hasText: GUARDED }).first()
    await expect(item).toBeVisible({ timeout: 10_000 })
    await item.getByTestId('review-deny').click()

    // The denial moves to Recently resolved with its outcome labeled.
    const resolvedItem = page.getByTestId('review-resolved-item').filter({ hasText: GUARDED }).first()
    await expect(resolvedItem).toBeVisible({ timeout: 10_000 })
    await expect(resolvedItem.getByTestId('review-resolution')).toHaveText('denied')

    // Design-wave-1 fix #4: a denied run's status pill reads ERROR and
    // must carry the same failure semantics (Primer's danger variant) as
    // the 'denied' resolution pill right next to it -- it used to fall
    // through to the neutral 'secondary' tone (review-light.png).
    const statusPill = resolvedItem.getByTestId('review-resolved-status')
    await expect(statusPill).toHaveText('ERROR')
    await expect(statusPill).toHaveAttribute('data-variant', 'danger')

    // The filter's own options come only from workflows that already
    // have a pending/resolved review item (ReviewView.tsx) -- on this
    // test's own dedicated, otherwise-empty server that means a second
    // workflow's item has to exist here too, for the filter to have
    // anything to narrow away from.
    const reviewSeed = 'Example: Human review with input'
    await page.getByRole('link', { name: 'Workflows' }).click()
    const reviewRow = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(reviewSeed, { exact: true }) })
    await reviewRow.getByRole('button', { name: 'Run' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Note').fill('')
    await dialog.getByRole('button', { name: 'Run' }).click()
    await page.getByRole('link', { name: 'Review' }).click()
    const reviewItem = page.getByTestId('review-item').filter({ hasText: reviewSeed }).first()
    await expect(reviewItem).toBeVisible({ timeout: 10_000 })
    await reviewItem.getByTestId('review-deny').click()
    await expect(page.getByTestId('review-item').filter({ hasText: reviewSeed })).toHaveCount(0, { timeout: 10_000 })

    // The workflow filter narrows both sections.
    await page.getByLabel('Filter by workflow').selectOption({ label: reviewSeed })
    await expect(page.getByTestId('review-resolved-item').filter({ hasText: GUARDED })).toHaveCount(0)
  } finally {
    await closeDedicatedServer(s)
  }
})

// Row drill-down (docs/goals/0002-review-queue-maturation.md item 5):
// every Review row -- pending or resolved -- opens its run in the
// app-wide work-tab shell at the workflow's Runs inner tab, with that
// run's own detail already open. Also covers the root-caused
// zero-time bug: a resolved row's timestamp must never render Go's
// zero time ("1-12-31, ...").

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Review row drill-down: a resolved row opens its run on the Runs tab with detail preselected, and its timestamp is real', async ({}, testInfo) => {
  const s = await openDedicatedServer('guardrail-review-drilldown', 30, testInfo.parallelIndex)
  try {
    const { page } = s
    await page.goto(`${s.server.baseURL}/`)
    await page.getByRole('link', { name: 'Workflows' }).click()
    const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(GUARDED, { exact: true }) })
    await row.getByRole('button', { name: 'Run' }).click()

    await page.getByRole('link', { name: 'Review' }).click()
    const item = page.getByTestId('review-item').filter({ hasText: GUARDED }).first()
    await expect(item).toBeVisible({ timeout: 10_000 })
    await item.getByTestId('review-deny').click()

    const resolvedItem = page.getByTestId('review-resolved-item').filter({ hasText: GUARDED }).first()
    await expect(resolvedItem).toBeVisible({ timeout: 10_000 })

    // The zero-time regression's exact repro string never renders, and
    // the timestamp reflects a real, current run (executionservice.go's
    // summaryFromStatus now falls back to CreatedAt when DBOS's own
    // StartedAt is zero).
    const timestampText = (await resolvedItem.textContent()) ?? ''
    expect(timestampText).not.toContain('1-12-31')
    expect(timestampText).toContain(String(new Date().getFullYear()))

    // Clicking the row itself (not a button) drills into the run: its
    // workflow's editor tab opens on the Runs inner tab, with this run's
    // own detail already open -- the ONE run-detail viewer (docs/SPEC.md
    // §7's lock), never rendered on Review itself.
    await resolvedItem.click()
    await expect(page.getByRole('tab', { name: 'Runs' })).toBeVisible()
    const detail = page.getByTestId('run-detail')
    await expect(detail).toBeVisible()
    await expect(detail).toContainText('denied by user')
  } finally {
    await closeDedicatedServer(s)
  }
})

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Review row drill-down: clicking a pending row opens its run too', async ({}, testInfo) => {
  const s = await openDedicatedServer('guardrail-review-pending-drilldown', 40, testInfo.parallelIndex)
  try {
    const { page } = s
    await page.goto(`${s.server.baseURL}/`)
    await page.getByRole('link', { name: 'Workflows' }).click()
    const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(GUARDED, { exact: true }) })
    await row.getByRole('button', { name: 'Run' }).click()

    await page.getByRole('link', { name: 'Review' }).click()
    const item = page.getByTestId('review-item').filter({ hasText: GUARDED }).first()
    await expect(item).toBeVisible({ timeout: 10_000 })

    // Click the row's label text (outside the stopPropagation-wrapped
    // input/button block) -- lands on the Runs tab with this still-parked
    // run's own detail (the approval banner) already open.
    await item.getByText(GUARDED, { exact: true }).click()
    await expect(page.getByRole('tab', { name: 'Runs' })).toBeVisible()
    const detail = page.getByTestId('run-detail')
    await expect(detail).toBeVisible()
    await expect(page.getByTestId('approval-banner')).toBeVisible()

    // Clean up: deny from here so nothing stays parked.
    await page.getByTestId('deny-step').click()
    await expect(detail).toContainText('denied by user', { timeout: 10_000 })
  } finally {
    await closeDedicatedServer(s)
  }
})

// Sidebar Review pending-count badge (docs/goals/0002 item 3, unified
// with 0005's guardrail-pending-changed event): the ONE Go-emitted
// event, refetched on receipt (never trusted as the source of truth --
// docs/goals/0005-pending-attention-model.md's own precedent). This
// test's own dedicated server starts with nothing pending, so the
// zero-badge assertion before its own Run click is a fresh-boot fact,
// not an order dependency on any other test.
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Sidebar Review badge shows a pending count while the guarded seed is parked, and drops after deny', async ({}, testInfo) => {
  const s = await openDedicatedServer('guardrail-review-badge', 50, testInfo.parallelIndex)
  try {
    const { page } = s
    await page.goto(`${s.server.baseURL}/`)
    await page.getByRole('link', { name: 'Workflows' }).click()
    await expect(page.getByTestId('review-pending-count')).toHaveCount(0)

    const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(GUARDED, { exact: true }) })
    await row.getByRole('button', { name: 'Run' }).click()

    const badge = page.getByTestId('review-pending-count')
    await expect(badge).toBeVisible({ timeout: 10_000 })
    await expect(badge).toHaveText('1')

    await page.getByRole('link', { name: 'Review' }).click()
    const item = page.getByTestId('review-item').filter({ hasText: GUARDED }).first()
    await expect(item).toBeVisible({ timeout: 10_000 })
    await item.getByTestId('review-deny').click()
    await expect(page.getByTestId('review-item').filter({ hasText: GUARDED })).toHaveCount(0, { timeout: 10_000 })

    // Event-driven refetch, not a poll: the badge disappears (count back
    // to 0) once guardrail-pending-changed fires the resolved event.
    await expect(page.getByTestId('review-pending-count')).toHaveCount(0, { timeout: 10_000 })
  } finally {
    await closeDedicatedServer(s)
  }
})

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Review row drill-down: pending-row Approve/Deny still resolve in place, without navigating', async ({}, testInfo) => {
  const s = await openDedicatedServer('guardrail-review-inplace', 60, testInfo.parallelIndex)
  try {
    const { page } = s
    await page.goto(`${s.server.baseURL}/`)
    await page.getByRole('link', { name: 'Workflows' }).click()
    const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(GUARDED, { exact: true }) })
    await row.getByRole('button', { name: 'Run' }).click()

    await page.getByRole('link', { name: 'Review' }).click()
    const item = page.getByTestId('review-item').filter({ hasText: GUARDED }).first()
    await expect(item).toBeVisible({ timeout: 10_000 })

    // The Deny button's own onClick stops propagation to the row's --
    // Review stays the active tab (no work tab opened) and the run
    // resolves in place, exactly as it did before row drill-down existed.
    await item.getByTestId('review-deny').click()
    await expect(page.getByTestId('review-view')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Runs' })).toHaveCount(0)
    await expect(page.getByTestId('review-item').filter({ hasText: GUARDED })).toHaveCount(0, { timeout: 10_000 })
  } finally {
    await closeDedicatedServer(s)
  }
})

// Kind filter + empty/loading polish (docs/goals/0002-review-queue-
// maturation.md item 4): three real pending kinds parked at once
// (a policy ask, a human-review checkpoint, and an MCP write request --
// docs/adr/0032), proving the Select appears only once 2+ kinds are
// present, narrows correctly per kind, and the calm Blankslate empty
// state shows once every kind is cleared back to zero.
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Review kind filter narrows pending rows by kind, and the Blankslate empty state shows once cleared', async ({}, testInfo) => {
  const s = await openDedicatedServer('guardrail-review-kind', 70, testInfo.parallelIndex)
  try {
    const { page } = s
    await page.goto(`${s.server.baseURL}/`)
    await page.getByRole('link', { name: 'Workflows' }).click()

    // Kind 1: a policy ask.
    const askRow = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(GUARDED, { exact: true }) })
    await askRow.getByRole('button', { name: 'Run' }).click()

    // Kind 2: a human-review checkpoint.
    const reviewSeed = 'Example: Human review with input'
    const reviewRow = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(reviewSeed, { exact: true }) })
    await reviewRow.getByRole('button', { name: 'Run' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Note').fill('')
    await dialog.getByRole('button', { name: 'Run' }).click()

    // Kind 3: an MCP write request -- export/re-import a throwaway
    // workflow over a real MCP client, same shape mcp-write-approval.spec.ts
    // uses (mcpTestClient.ts is the shared helper both now import).
    await enableMCPWritesWithApprovalRequired(page)
    await page.getByRole('link', { name: 'Workflows' }).click()
    await page.getByTestId('new-workflow').click()
    await page.locator('[role="tabpanel"]:not([hidden])').last().getByLabel('Label').fill('E2E kind-filter MCP source')
    await page.locator('[role="tabpanel"]:not([hidden])').last().getByTestId('save-workflow').click()
    const mcpSourceRow = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText('E2E kind-filter MCP source', { exact: true }) })
    await expect(mcpSourceRow).toBeVisible()

    const client = await connectMCPClient(testInfo.parallelIndex, GUARDRAIL_REVIEW_MCP_BASE_PORT + 70 + testInfo.parallelIndex)
    const sourceId = await findWorkflowIdByLabel(client, 'E2E kind-filter MCP source')
    const exported = await exportWorkflowViaMCP(client, sourceId)
    // ADR-0036: strip the source's real id so this exercises the create
    // path (a second, independent workflow), not an update-in-place of
    // the source that's still present.
    const importResultPromise = client.callTool({ name: 'import_workflow', arguments: { json: stripExportedID(exported) } })

    // All three kinds pending at once -- the Select appears (2+ kinds).
    await page.getByRole('link', { name: 'Review' }).click()
    const kindSelect = page.getByTestId('review-kind-filter')
    await expect(kindSelect).toBeVisible({ timeout: 15_000 })

    // "Awaiting approval" narrows to just the guardrail ask.
    await kindSelect.selectOption({ label: 'Awaiting approval' })
    await expect(page.getByTestId('review-item').filter({ hasText: GUARDED })).toBeVisible()
    await expect(page.getByTestId('review-item').filter({ hasText: reviewSeed })).toHaveCount(0)
    await expect(page.getByTestId('review-mcp-write-item')).toHaveCount(0)

    // "Ask for review" narrows to just the checkpoint.
    await kindSelect.selectOption({ label: 'Ask for review' })
    await expect(page.getByTestId('review-item').filter({ hasText: reviewSeed })).toBeVisible()
    await expect(page.getByTestId('review-item').filter({ hasText: GUARDED })).toHaveCount(0)
    await expect(page.getByTestId('review-mcp-write-item')).toHaveCount(0)

    // "MCP write request" narrows to just the pending write.
    await kindSelect.selectOption({ label: 'MCP write request' })
    await expect(page.getByTestId('review-mcp-write-item')).toBeVisible()
    await expect(page.getByTestId('review-item')).toHaveCount(0)

    // Back to "All kinds": every row is visible again.
    await kindSelect.selectOption({ label: 'All kinds' })
    await expect(page.getByTestId('review-item').filter({ hasText: GUARDED })).toBeVisible()
    await expect(page.getByTestId('review-item').filter({ hasText: reviewSeed })).toBeVisible()
    await expect(page.getByTestId('review-mcp-write-item')).toBeVisible()

    // Clear every kind back to zero: deny both runs, approve the write.
    await page.getByTestId('review-item').filter({ hasText: GUARDED }).getByTestId('review-deny').click()
    await expect(page.getByTestId('review-item').filter({ hasText: GUARDED })).toHaveCount(0, { timeout: 10_000 })
    await page.getByTestId('review-item').filter({ hasText: reviewSeed }).getByTestId('review-deny').click()
    await expect(page.getByTestId('review-item').filter({ hasText: reviewSeed })).toHaveCount(0, { timeout: 10_000 })
    await page.getByTestId('review-mcp-write-item').getByTestId('review-mcp-write-approve').click()
    await expect(page.getByTestId('review-mcp-write-item')).toHaveCount(0, { timeout: 10_000 })

    const result = await importResultPromise
    await client.close()
    if (result.isError) throw new Error(`import_workflow ultimately errored: ${JSON.stringify(result.content)}`)

    // Nothing pending: the kind Select disappears (fewer than 2 kinds
    // present) and the calm Blankslate empty state shows -- full anatomy
    // (heading + description explaining where an approval would come
    // from), not just a bare heading.
    await expect(page.getByTestId('review-kind-filter')).toHaveCount(0)
    const reviewEmpty = page.getByTestId('review-empty')
    await expect(reviewEmpty).toBeVisible({ timeout: 10_000 })
    await expect(reviewEmpty.getByText('Approvals land here when a workflow needs your review')).toBeVisible()

    // Cleanup: both minted workflows (import always mints a new ID), and
    // the MCP-write settings toggle.
    await page.getByRole('link', { name: 'Workflows' }).click()
    let remaining = await mcpSourceRow.count()
    while (remaining > 0) {
      await clickRowAction(page, mcpSourceRow.first(), 'Delete')
      remaining -= 1
      await expect(mcpSourceRow).toHaveCount(remaining)
    }
    await restoreMCPWriteDefaults(page)
  } finally {
    await closeDedicatedServer(s)
  }
})
