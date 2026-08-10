import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { clickRowAction } from './inventoryRow'
import {
  PERSISTENCE_MCP_BASE_PORT,
  PERSISTENCE_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'

// goal 0009 (docs/goals/0009-e2e-parallel-isolation.md): the one
// deliberate exception to "every worker's server is fully isolated and
// disposable." Real persistence -- a composed workflow surviving an
// actual process restart, not just staying in one long-lived process's
// memory -- is load-bearing behavior (internal/adapters/settings writes
// through to a real JSON file on disk) and needs its own proof, kept
// separate from every other spec so nothing else in the suite depends
// on this file's own restart choreography. Deliberately bypasses the
// standard per-worker `workerServer` fixture (./fixtures/server.ts) and
// drives its own chromium instance directly (the same pattern the old
// global-setup.ts used) -- this test owns two server lifetimes, not
// one, so the standard one-server-per-worker fixture doesn't fit it.
//
// Ports come from a range (fixtures/server.ts's PERSISTENCE_* constants)
// disjoint from both the standard per-worker range and Mill's own
// defaults (8080/8090, a real always-on LaunchAgent instance on this
// machine) -- collision-proof regardless of how many other workers are
// concurrently spawning their own standard servers.
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('A composed workflow survives its own server process restarting against the same settings file', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-persist-${idx}-`))
  const settingsPath = path.join(dir, 'settings.json')
  const executionDbPath = path.join(dir, 'execution.db')
  const port = PERSISTENCE_SERVER_BASE_PORT + idx
  const mcpPort = PERSISTENCE_MCP_BASE_PORT + idx

  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({ port, mcpPort, settingsPath, executionDbPath })
    const label = 'E2E persistence-across-restart workflow'

    const page1 = await browser.newPage()
    await page1.goto(`${server.baseURL}/`)
    await page1.getByRole('link', { name: 'Workflows' }).click()
    await page1.getByTestId('new-workflow').click()
    await page1.getByLabel('Label').fill(label)
    await page1.getByTestId('save-workflow').click()

    const row1 = page1.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ hasText: label })
    await expect(row1).toBeVisible()
    await page1.close()

    // The actual proof: kill this exact process (never anyone else's --
    // `stop()` only ever signals the PID `spawn()` itself returned) and
    // start a brand-new one pointed at the identical settingsPath. If
    // the workflow is only visible because the first process kept it in
    // memory, this second process would come up without it.
    await server.stop()
    server = await spawnMillServer({ port, mcpPort, settingsPath, executionDbPath })

    const page2 = await browser.newPage()
    await page2.goto(`${server.baseURL}/`)
    await page2.getByRole('link', { name: 'Workflows' }).click()
    const row2 = page2.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ hasText: label })
    await expect(row2).toBeVisible()

    // Clean up the entity, not just the process/files -- same discipline
    // every other spec in this suite follows (.claude/rules/testing.md),
    // even though this settings file is thrown away immediately after.
    await clickRowAction(page2, row2, 'Delete')
    await expect(row2).toHaveCount(0)
    await page2.close()
  } finally {
    await browser.close()
    if (server) await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
