import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnMillServer, type SpawnedServer } from './fixtures/server'
import { REVIEW_PARKED_PAYLOAD_MCP_BASE_PORT, REVIEW_PARKED_PAYLOAD_SERVER_BASE_PORT } from './fixtures/serverPorts'

// A parked payload is PRESENTED, never typed (goal 0326): an approver
// reads what the step is about to act on through the shared output
// viewer, with Copy on the same toolbar and nothing to type into.
//
// The seeded working-directory example is the driver: its payload
// carries the working-directory line the runtime prepends before it
// parks, so there is real content to present rather than an empty
// payload.
//
// Its own dedicated server pair, not the shared pool: parking a run
// puts an item in the GLOBAL Review queue (.claude/rules/testing.md's
// shared-vs-dedicated rule), the same reasoning review-open-run.spec.ts
// records for its own pair.

const WORKFLOW = 'Example: Run in the captured folder'

interface SpawnedPage {
  server: SpawnedServer
  browser: Browser
  page: Page
  dir: string
}

async function openDedicatedServer(idx: number): Promise<SpawnedPage> {
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-review-parked-payload-${idx}-`))
  const browser = await chromium.launch()
  const server = await spawnMillServer({
    port: REVIEW_PARKED_PAYLOAD_SERVER_BASE_PORT + idx,
    mcpPort: REVIEW_PARKED_PAYLOAD_MCP_BASE_PORT + idx,
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

// eslint-disable-next-line no-empty-pattern -- needs testInfo (the second arg), no fixture.
test('Review presents a parked payload through the output viewer', async ({}, testInfo) => {
  const s = await openDedicatedServer(testInfo.parallelIndex)
  try {
    const { page } = s
    await page.goto(`${s.server.baseURL}/`)
    await page.getByRole('link', { name: 'Workflows' }).click()
    const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]')
      .filter({ has: page.getByText(WORKFLOW, { exact: true }) })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: `Run ${WORKFLOW}` }).click()
    // This example takes a typed attribute, so Run opens the test-run
    // dialog first; its default folder is where the step then runs.
    await page.getByRole('button', { name: 'Run', exact: true }).click()

    await page.getByRole('link', { name: 'Review' }).click()
    const item = page.getByTestId('review-item').filter({ hasText: WORKFLOW }).first()
    await expect(item).toBeVisible({ timeout: 15_000 })
    const parked = item.getByTestId('review-parked-payload')
    await expect(parked).toBeVisible()
    await expect(parked.getByTestId('output-copy')).toBeVisible()
    // Read-only by construction: an approver can select the payload,
    // but there is nothing here to type into.
    await expect(parked.locator('textarea')).toHaveCount(0)
    await expect(parked).toContainText('Working directory')

    await item.getByTestId('review-deny').click()
    await expect(page.getByTestId('review-item').filter({ hasText: WORKFLOW })).toHaveCount(0, { timeout: 10_000 })
  } finally {
    await closeDedicatedServer(s)
  }
})
