import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  spawnMillServer,
  type SpawnedServer,
  UPDATES_BETA_MCP_BASE_PORT,
  UPDATES_BETA_SERVER_BASE_PORT,
  UPDATES_CHANNEL_PREF_MCP_BASE_PORT,
  UPDATES_CHANNEL_PREF_SERVER_BASE_PORT,
  UPDATES_RELEASE_MCP_BASE_PORT,
  UPDATES_RELEASE_SERVER_BASE_PORT,
  UPDATES_SOURCE_MCP_BASE_PORT,
  UPDATES_SOURCE_SERVER_BASE_PORT,
} from './fixtures/server'

// goal 0082: channel-aware updates (beta channel added goal 0100).
// Every channel renders from the same binary, distinguished only by
// MILL_TEST_UPDATE_CHANNEL -- a real release/beta-channel build is
// stamped at compile time (main.go's millChannel, ldflags-overridden
// by release.yml / ci.yml's beta-release job), so proving every
// branch of the UI needs this env seam instead. MILL_TEST_UPDATE_
// FAKE_VERSION makes CheckForUpdates return a canned "update
// available" result with no network call, so the available-update card
// renders deterministically. Never click "Update now" here -- the real
// download/verify/swap/restart path is OS-bound (and, since goal 0100,
// gated on a real pre-swap backup) and can only be proven against a
// genuine newer GitHub release from an installed release/beta-channel
// build (see testing.md's manual-only registry entry). Deliberately
// bypasses the standard per-worker fixture (same reasoning as
// persistence.spec.ts): each test needs its own server carrying a
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

    // A failed install surfaces the browser-download escape hatch, not
    // just the raw error (fake mode's DownloadAndInstallUpdate always
    // refuses, standing in for the real blocked-network 403 class).
    await card.getByTestId('update-now').click()
    await expect(card).toContainText("Couldn't install the update")
    await expect(card).toContainText('Get the update with your browser instead')
    await expect(card.getByTestId('open-releases-page')).toBeVisible()

    await page.close()
  } finally {
    await server?.stop()
    if (dir) rmSync(dir, { recursive: true, force: true })
    await browser.close()
  }
})

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Beta-channel build shows the primary Update now button and the beta channel label', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  let server: SpawnedServer | undefined
  let dir: string | undefined
  const browser = await chromium.launch()
  try {
    ;({ server, dir } = await spawnUpdatesServer(idx, UPDATES_BETA_SERVER_BASE_PORT, UPDATES_BETA_MCP_BASE_PORT, {
      MILL_TEST_UPDATE_FAKE_VERSION: '9.9.9',
      MILL_TEST_UPDATE_CHANNEL: 'beta',
    }))
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Settings' }).click()

    await expect(page.getByTestId('current-app-version')).toContainText('installed from the beta channel')

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

// The channel opt-in (goal 0100 follow-up slice): a
// source-built copy can point the updater at the beta feed. The
// preference persists to the settings store and applies on the next
// boot (the provider's feed is fixed at Init), so the UI must say so
// -- this pins the select, the saved-note, and persistence across a
// reload.
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Update-channel preference saves, explains the restart, and survives a reload', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  let server: SpawnedServer | undefined
  let dir: string | undefined
  const browser = await chromium.launch()
  try {
    ;({ server, dir } = await spawnUpdatesServer(idx, UPDATES_CHANNEL_PREF_SERVER_BASE_PORT, UPDATES_CHANNEL_PREF_MCP_BASE_PORT, {}))
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Settings' }).click()

    // Outbound proxy (goal 0123): invalid URL surfaces the validation
    // error; a valid one saves with the restart note and survives a
    // reload alongside the channel preference.
    const proxyInput = page.getByTestId('proxy-url-input')
    await proxyInput.fill('not a url')
    await page.getByTestId('proxy-url-save').click()
    await expect(page.getByTestId('proxy-error')).toContainText('http or https URL')
    await proxyInput.fill('http://proxy.example.com:8080')
    await page.getByTestId('proxy-url-save').click()
    await expect(page.getByTestId('proxy-saved-note')).toContainText('Restart Mill')

    const select = page.getByTestId('update-channel-select')
    await expect(select).toHaveValue('')
    await select.selectOption('beta')
    await expect(page.getByTestId('update-channel-saved')).toContainText('Restart Mill')

    await page.reload()
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByTestId('update-channel-select')).toHaveValue('beta')

    await page.close()
  } finally {
    await server?.stop()
    if (dir) rmSync(dir, { recursive: true, force: true })
    await browser.close()
  }
})
