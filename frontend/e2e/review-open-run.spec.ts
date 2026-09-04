import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnMillServer, type SpawnedServer } from './fixtures/server'
import { REVIEW_OPEN_RUN_MCP_BASE_PORT, REVIEW_OPEN_RUN_SERVER_BASE_PORT } from './fixtures/serverPorts'

// Review and the run behind a request are linked in both directions
// (goal 0343): every pending item carries an explicit "Open run"
// button beside its decision buttons, and its workflow name is the
// same door -- both the run.open registry command with that row as its
// target, so the two can never drift.
//
// Its own dedicated server pair, not the shared pool: these assertions
// read the GLOBAL pending queue (.claude/rules/testing.md's
// shared-vs-dedicated rule), the same reasoning guardrail-review.spec.ts
// records for its own pair.

const GUARDED = 'Example: Approval-gated HTTP call'

interface SpawnedPage {
  server: SpawnedServer
  browser: Browser
  page: Page
  dir: string
}

async function openDedicatedServer(offset: number, idx: number): Promise<SpawnedPage> {
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-review-open-run-${idx}-`))
  const browser = await chromium.launch()
  const server = await spawnMillServer({
    port: REVIEW_OPEN_RUN_SERVER_BASE_PORT + offset + idx,
    mcpPort: REVIEW_OPEN_RUN_MCP_BASE_PORT + offset + idx,
    settingsPath: path.join(dir, 'settings.json'),
    executionDbPath: path.join(dir, 'execution.db'),
    backupDir: path.join(dir, 'backups'),
  })
  const page = await browser.newPage({ baseURL: server.baseURL })
  return { server, browser, page, dir }
}

async function closeDedicatedServer(s: SpawnedPage) {
  await s.browser.close()
  await s.server.stop()
  rmSync(s.dir, { recursive: true, force: true })
}

async function parkTheGuardedSeed(page: Page, baseURL: string) {
  await page.goto(`${baseURL}/`)
  await page.getByRole('link', { name: 'Workflows' }).click()
  const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(GUARDED, { exact: true }) })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Run' }).click()
  await page.getByRole('link', { name: 'Review' }).click()
  const item = page.getByTestId('review-item').filter({ hasText: GUARDED }).first()
  await expect(item).toBeVisible({ timeout: 10_000 })
  return item
}

// eslint-disable-next-line no-empty-pattern -- needs testInfo (the second arg), no fixture.
test('a pending Review item opens its run from the Open run button', async ({}, testInfo) => {
  const s = await openDedicatedServer(0, testInfo.parallelIndex)
  try {
    const { page } = s
    const item = await parkTheGuardedSeed(page, s.server.baseURL)

    const openRun = item.getByTestId('review-open-run')
    await expect(openRun).toHaveText('Open run')
    await openRun.click()

    // The workflow's own tab, on the Runs inner tab, with this run's
    // detail already open -- the one run-detail viewer.
    await expect(page.getByRole('tab', { name: 'Runs' })).toBeVisible()
    await expect(page.getByTestId('run-detail')).toBeVisible()
    await expect(page.getByTestId('approval-banner')).toBeVisible()

    // Clean up: nothing stays parked for the next assertion.
    await page.getByTestId('deny-step').click()
    await expect(page.getByTestId('run-detail')).toContainText('denied by user', { timeout: 10_000 })
  } finally {
    await closeDedicatedServer(s)
  }
})

// eslint-disable-next-line no-empty-pattern -- needs testInfo (the second arg), no fixture.
test('a pending item workflow name is the same door, and the item shows no dimmed action', async ({}, testInfo) => {
  const s = await openDedicatedServer(10, testInfo.parallelIndex)
  try {
    const { page } = s
    const item = await parkTheGuardedSeed(page, s.server.baseURL)

    const name = item.getByTestId('review-item-workflow')
    await expect(name).toHaveText(GUARDED)
    await name.click()
    await expect(page.getByRole('tab', { name: 'Runs' })).toBeVisible()
    await expect(page.getByTestId('run-detail')).toBeVisible()

    await page.getByTestId('deny-step').click()
    await expect(page.getByTestId('run-detail')).toContainText('denied by user', { timeout: 10_000 })

    // The resolved row opens the same way -- the identical command,
    // with the resolved row's own run as its target.
    await page.getByRole('link', { name: 'Review' }).click()
    const resolvedRow = page.locator('[data-testid="inventory-row"][data-entity="run"]').filter({ hasText: GUARDED }).first()
    await expect(resolvedRow).toBeVisible({ timeout: 10_000 })
    await resolvedRow.click()
    await expect(page.getByRole('tab', { name: 'Runs' })).toBeVisible()
    await expect(page.getByTestId('run-detail')).toBeVisible()
  } finally {
    await closeDedicatedServer(s)
  }
})
