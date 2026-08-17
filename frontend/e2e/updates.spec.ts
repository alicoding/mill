import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  spawnMillServer,
  type SpawnedServer,
  UPDATES_RELEASE_MCP_BASE_PORT,
  UPDATES_RELEASE_SERVER_BASE_PORT,
  UPDATES_SOURCE_MCP_BASE_PORT,
  UPDATES_SOURCE_SERVER_BASE_PORT,
} from './fixtures/server'

// goal 0082: channel-aware updates. Both channels render from the same
// binary, distinguished only by MILL_TEST_UPDATE_CHANNEL -- a real
// release-channel build is stamped at compile time (main.go's
// millChannel, ldflags-overridden by release.yml), so proving BOTH
// branches of the UI needs this env seam instead. MILL_TEST_UPDATE_
// FAKE_VERSION makes CheckForUpdates return a canned "update
// available" result with no network call, so the available-update card
// renders deterministically. Never click "Update now" here -- the real
// download/verify/swap/restart path is OS-bound and can only be proven
// against a genuine newer GitHub release from an installed
// release-channel build (see testing.md's manual-only registry entry).
// Deliberately bypasses the standard per-worker fixture (same reasoning
// as persistence.spec.ts): each test needs its own server carrying a
// fixed MILL_TEST_UPDATE_* env for its whole lifetime, on its own
// disjoint port pair.

async function spawnUpdatesServer(
  idx: number,
  serverBasePort: number,
  mcpBasePort: number,
  extraEnv: Record<string, string>,
): Promise<{ server: SpawnedServer; dir: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-updates-${idx}-`))
  const server = await spawnMillServer({
    port: serverBasePort + idx,
    mcpPort: mcpBasePort + idx,
    settingsPath: path.join(dir, 'settings.json'),
    executionDbPath: path.join(dir, 'execution.db'),
    backupDir: path.join(dir, 'backups'),
    extraEnv,
  })
  return { server, dir }
}

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Source-channel build never shows Update now, and shows the pull-and-rebuild instructions', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  let server: SpawnedServer | undefined
  let dir: string | undefined
  const browser = await chromium.launch()
  try {
    ;({ server, dir } = await spawnUpdatesServer(idx, UPDATES_SOURCE_SERVER_BASE_PORT, UPDATES_SOURCE_MCP_BASE_PORT, {
      MILL_TEST_UPDATE_FAKE_VERSION: '9.9.9',
    }))
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Settings' }).click()

    await expect(page.getByTestId('current-app-version')).toContainText('built from source')

    await page.getByTestId('check-for-updates').click()
    const card = page.getByTestId('update-available-card')
    await expect(card).toBeVisible()
    await expect(card).toContainText('9.9.9')

    await card.getByText("What's new").click()
    await expect(page.getByTestId('update-notes')).toContainText('Fake note one')

    await expect(card).toContainText('This copy was built from source')
    await expect(card).toContainText('git pull, then task install:app')
    await expect(card.getByTestId('update-now')).toHaveCount(0)

    await page.close()
  } finally {
    await server?.stop()
    if (dir) rmSync(dir, { recursive: true, force: true })
    await browser.close()
  }
})

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Release-channel build shows the primary Update now button and no source hint', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  let server: SpawnedServer | undefined
  let dir: string | undefined
  const browser = await chromium.launch()
  try {
    ;({ server, dir } = await spawnUpdatesServer(idx, UPDATES_RELEASE_SERVER_BASE_PORT, UPDATES_RELEASE_MCP_BASE_PORT, {
      MILL_TEST_UPDATE_FAKE_VERSION: '9.9.9',
      MILL_TEST_UPDATE_CHANNEL: 'release',
    }))
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Settings' }).click()

    await expect(page.getByTestId('current-app-version')).toContainText('installed from a release')

    await page.getByTestId('check-for-updates').click()
    const card = page.getByTestId('update-available-card')
    await expect(card).toBeVisible()

    await expect(card.getByTestId('update-now')).toBeVisible()
    await expect(card.getByTestId('update-now')).toHaveText('Update now')
    await expect(card).not.toContainText('This copy was built from source')

    await page.close()
  } finally {
    await server?.stop()
    if (dir) rmSync(dir, { recursive: true, force: true })
    await browser.close()
  }
})
