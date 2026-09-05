import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  REVIEW_RESOLVED_HISTORY_MCP_BASE_PORT, REVIEW_RESOLVED_HISTORY_SERVER_BASE_PORT,
  spawnMillServer, type SpawnedServer,
} from './fixtures/server'

// Review's Recently-resolved history on the one list standard (goal
// 0337 S2): proves the section's own toolbar (search, count) renders
// over a real queue of resolved runs, and that the pending inbox above
// it stays untouched by the same change. Dedicated server (testing.md's
// shared-vs-dedicated rule): Review's queue is global app state, same
// reasoning as guardrail-review.spec.ts.

const GUARDED = 'Post an update to the client portal'

interface SpawnedPage {
  server: SpawnedServer
  browser: Browser
  page: Page
  dir: string
}

async function openDedicatedServer(idx: number): Promise<SpawnedPage> {
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-review-resolved-history-${idx}-`))
  const port = REVIEW_RESOLVED_HISTORY_SERVER_BASE_PORT + idx
  const mcpPort = REVIEW_RESOLVED_HISTORY_MCP_BASE_PORT + idx
  const browser = await chromium.launch()
  const server = await spawnMillServer({
    port, mcpPort,
    settingsPath: path.join(dir, 'settings.json'),
    executionDbPath: path.join(dir, 'execution.db'),
    backupDir: path.join(dir, 'backups'),
  })
  const page = await browser.newPage({ baseURL: server.baseURL })
  return { server, browser, page, dir }
}

async function closeDedicatedServer(s: SpawnedPage): Promise<void> {
  await s.browser.close()
  await s.server.stop()
  rmSync(s.dir, { recursive: true, force: true })
}

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Recently resolved wears the list toolbar: search, an own-item count, and the pending inbox above stays a plain queue', async ({}, testInfo) => {
  const s = await openDedicatedServer(testInfo.parallelIndex)
  try {
    const { page } = s
    await page.goto('/')

    // Three park-then-deny cycles -- enough to prove the toolbar and
    // count without the minutes a run-25-times seed would cost.
    for (let i = 0; i < 3; i++) {
      await page.getByRole('link', { name: 'Workflows' }).click()
      const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(GUARDED, { exact: true }) })
      await row.getByRole('button', { name: 'Run' }).click()

      await page.getByRole('link', { name: 'Review' }).click()
      const item = page.getByTestId('review-item').filter({ hasText: GUARDED }).first()
      await expect(item).toBeVisible({ timeout: 10_000 })
      await item.getByTestId('review-deny').click()
      await expect(page.getByTestId('review-item').filter({ hasText: GUARDED })).toHaveCount(0, { timeout: 10_000 })
    }

    // The pending inbox's own toolbar carries the workflow/kind filters
    // but no count -- it stays an inbox, not a list (goal 0337 S2).
    const pendingSearch = page.getByTestId('review-queue-search')
    await expect(pendingSearch).toBeVisible()
    await expect(page.getByTestId('review-item')).toHaveCount(0, { timeout: 10_000 })

    // The resolved history below is the standard InventoryList: its own
    // search box (the default testid, distinct from the pending inbox's
    // overridden one) and an own-item count reading all three denials.
    const resolvedSearch = page.getByTestId('inventory-search')
    await expect(resolvedSearch).toBeVisible()
    const count = page.getByTestId('list-count')
    await expect(count).toHaveText('3')
    await expect(page.getByTestId('inventory-row')).toHaveCount(3)

    // The toolbar's search narrows the resolved history to the matching
    // workflow, same substring match as every other list on the standard.
    await resolvedSearch.fill('nonexistent workflow name')
    await expect(page.getByTestId('inventory-row')).toHaveCount(0)
    await expect(page.getByText('No matches for "nonexistent workflow name".')).toBeVisible()
  } finally {
    await closeDedicatedServer(s)
  }
})
