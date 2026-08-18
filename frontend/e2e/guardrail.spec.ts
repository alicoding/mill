import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  GUARDRAIL_SPEC_MCP_BASE_PORT,
  GUARDRAIL_SPEC_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'

// The guardrail execution gate end-to-end in the live app (docs/SPEC.md
// §8, ADR-0019/0022), driven through the seeded "Example:
// Approval-gated HTTP call" workflow -- the seed IS the proof
// (.claude/rules/testing.md). Every path here is deterministic: the
// deny path never lets the external HTTP call actually run, and the
// dry-run tester evaluates rules without executing anything.
//
// Runs on its own dedicated server (fixtures/server.ts's
// GUARDRAIL_SPEC_* ports), not the standard per-worker pool: this
// file's Review-queue tests (guardrail-review.spec.ts) assert exact
// pending/resolved queue state, which must never be contaminated by
// another spec cohabiting a shared worker's one server.

const GUARDED = 'Example: Approval-gated HTTP call'

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Running the guarded seed parks awaiting approval; deny fails it closed', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-guardrail-${idx}-`))
  const port = GUARDRAIL_SPEC_SERVER_BASE_PORT + idx
  const mcpPort = GUARDRAIL_SPEC_MCP_BASE_PORT + idx

  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({
      port, mcpPort,
      settingsPath: path.join(dir, 'settings.json'),
      executionDbPath: path.join(dir, 'execution.db'),
      backupDir: path.join(dir, 'backups'),
    })
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Workflows' }).click()
    const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(GUARDED, { exact: true }) })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Run' }).click()

    // The run returns immediately (non-blocking start) -- open its Runs
    // tab to find it awaiting approval.
    await row.click()
    await page.getByRole('tab', { name: 'Runs' }).click()
    await expect(page.getByTestId('run-awaiting-approval').first()).toBeVisible({ timeout: 10_000 })

    // Open the parked run by clicking its ROW (owner's model: the row IS
    // the View affordance, no separate button). Selection feedback
    // (live-reproduced: identical-outcome runs made a click look like a
    // no-op): the clicked row highlights via its data-selected anchor,
    // and the detail header carries the run's own timestamp identity.
    await page.getByTestId('runs-table').locator('tbody tr').first().click()
    await expect(page.getByTestId('runs-table').locator('[data-selected="true"]')).toHaveCount(1)
    await expect(page.getByTestId('run-detail-identity')).toContainText('Run ·')
    const banner = page.getByTestId('approval-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('Integration: HTTP call')

    // Deny: the run fails closed with the reason, and no approval banner
    // remains.
    await banner.getByTestId('deny-step').click()
    await expect(page.getByTestId('run-detail')).toContainText('denied by user', { timeout: 10_000 })
    await expect(page.getByTestId('approval-banner')).toHaveCount(0)
  } finally {
    await browser.close()
    if (server) await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Nothing hidden: the canvas badges the guarded step and the Inspector shows its verdict', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-guardrail-badge-${idx}-`))
  // Offset from the file's other test's own port pair (same worker
  // parallelIndex would otherwise collide across these two tests in
  // this file).
  const port = GUARDRAIL_SPEC_SERVER_BASE_PORT + 10 + idx
  const mcpPort = GUARDRAIL_SPEC_MCP_BASE_PORT + 10 + idx

  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({
      port, mcpPort,
      settingsPath: path.join(dir, 'settings.json'),
      executionDbPath: path.join(dir, 'execution.db'),
      backupDir: path.join(dir, 'backups'),
    })
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Workflows' }).click()
    const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(GUARDED, { exact: true }) })
    await row.click()

    // The HTTP step carries a visible shield badge BEFORE any run.
    const badge = page.getByTestId('canvas-guardrail-badge')
    await expect(badge).toBeVisible()
    await expect(badge).toHaveAttribute('data-effect', 'ask')

    // Selecting the step shows the read-only verdict -- authoring points
    // at Configure, never inline (corrected by direct discussion).
    await page.locator('[data-id="example-guarded-http"]').click()
    await expect(page.getByTestId('node-guardrail-verdict')).toHaveText('ask')
    await expect(page.getByTestId('node-guardrail-section')).toContainText('Approvals happen in Review')
  } finally {
    await browser.close()
    if (server) await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
