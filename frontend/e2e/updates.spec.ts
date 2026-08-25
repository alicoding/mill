import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  spawnMillServer,
  type SpawnedServer,
  UPDATES_AUTOCHECK_MCP_BASE_PORT,
  UPDATES_AUTOCHECK_SERVER_BASE_PORT,
  UPDATES_BETA_MCP_BASE_PORT,
  UPDATES_BETA_SERVER_BASE_PORT,
  UPDATES_READY_MCP_BASE_PORT,
  UPDATES_READY_SERVER_BASE_PORT,
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
    // goal 0127: the in-app card never shows the releases page's
    // manual-install section (trimmed at the in-app-notes-end marker).
    await expect(page.getByTestId('update-notes')).not.toContainText('xattr')
    await expect(page.getByTestId('update-notes')).not.toContainText('Manual install')

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
    // goal 0127: the failure carries a copyable diagnosis.
    await expect(card.getByTestId('update-error-copy')).toBeVisible()

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

    // goal 0122: the check also lights the footer notice pill; dismiss
    // hides it for THIS version and survives a reload.
    await expect(page.getByTestId('notice-update-available')).toBeVisible()
    await page.getByTestId('notice-dismiss').click()
    await expect(page.getByTestId('notice-update-available')).toHaveCount(0)
    await page.reload()
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByTestId('check-for-updates').click()
    await expect(page.getByTestId('update-available-card')).toBeVisible()
    await expect(page.getByTestId('notice-update-available')).toHaveCount(0)

    // Auto-check opt-in persists (default off).
    const auto = page.getByTestId('auto-update-check')
    await expect(auto).not.toBeChecked()
    await auto.check()
    await page.reload()
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByTestId('auto-update-check')).toBeChecked()

    await page.close()
  } finally {
    await server?.stop()
    if (dir) rmSync(dir, { recursive: true, force: true })
    await browser.close()
  }
})

// goal 0122: the ready state renders the accent relaunch pill --
// forced via the MILL_TEST_UPDATE_READY seam (a real install can't run
// in e2e; the manual-only registry covers the live swap).
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('An installed update shows the relaunch pill in the footer', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  let server: SpawnedServer | undefined
  let dir: string | undefined
  const browser = await chromium.launch()
  try {
    ;({ server, dir } = await spawnUpdatesServer(idx, UPDATES_READY_SERVER_BASE_PORT, UPDATES_READY_MCP_BASE_PORT, {
      MILL_TEST_UPDATE_READY: '1',
    }))
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await expect(page.getByTestId('notice-update-ready')).toContainText('Relaunch')
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

    // Outbound proxy (goal 0123): Auto is the default with no URL
    // field; Manual reveals it (invalid URL surfaces the validation
    // error, a valid one saves with the restart note); the choice
    // survives a reload alongside the channel preference.
    const modeSelect = page.getByTestId('proxy-mode-select')
    await expect(modeSelect).toHaveValue('auto')
    await expect(page.getByTestId('proxy-url-input')).toHaveCount(0)
    await modeSelect.selectOption('manual')
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
    await expect(page.getByTestId('proxy-mode-select')).toHaveValue('manual')
    await expect(page.getByTestId('proxy-url-input')).toHaveValue('http://proxy.example.com:8080')

    await page.close()
  } finally {
    await server?.stop()
    if (dir) rmSync(dir, { recursive: true, force: true })
    await browser.close()
  }
})

// goal 0205 S4: opening Settings must never leave the user reading a
// stale cached outcome as current -- a fresh check now fires the
// moment the section mounts, with no click required.
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Opening the Updates section checks automatically, with no click required', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  let server: SpawnedServer | undefined
  let dir: string | undefined
  const browser = await chromium.launch()
  try {
    ;({ server, dir } = await spawnUpdatesServer(idx, UPDATES_AUTOCHECK_SERVER_BASE_PORT, UPDATES_AUTOCHECK_MCP_BASE_PORT, {
      MILL_TEST_UPDATE_FAKE_VERSION: '9.9.9',
    }))
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Settings' }).click()

    // No click on check-for-updates anywhere in this test -- the card
    // and the fresh-outcome line must appear from the mount-time check
    // alone.
    await expect(page.getByTestId('update-available-card')).toBeVisible()
    await expect(page.getByTestId('update-available-card')).toContainText('9.9.9')
    await expect(page.getByTestId('last-check-status')).toContainText('just now')

    await page.close()
  } finally {
    await server?.stop()
    if (dir) rmSync(dir, { recursive: true, force: true })
    await browser.close()
  }
})

// goal 0205 S4: the checking state must be visibly distinct from both
// a cached outcome and a fresh result -- proven deterministically via
// the delay seam rather than racing a same-tick promise.
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('The Updates section shows a checking state while the automatic check is in flight', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  let server: SpawnedServer | undefined
  let dir: string | undefined
  const browser = await chromium.launch()
  try {
    ;({ server, dir } = await spawnUpdatesServer(idx, UPDATES_AUTOCHECK_SERVER_BASE_PORT, UPDATES_AUTOCHECK_MCP_BASE_PORT, {
      MILL_TEST_UPDATE_FAKE_VERSION: '9.9.9',
      MILL_TEST_UPDATE_CHECK_DELAY_MS: '1500',
    }))
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Settings' }).click()

    const checkButton = page.getByTestId('check-for-updates')
    await expect(checkButton).toHaveText('Checking…')
    await expect(checkButton).toBeDisabled()
    await expect(page.getByTestId('update-available-card')).toHaveCount(0)

    // The delayed check lands, and the checking state clears.
    await expect(page.getByTestId('update-available-card')).toBeVisible()
    await expect(checkButton).toBeEnabled()
    await expect(checkButton).not.toHaveText('Checking…')

    await page.close()
  } finally {
    await server?.stop()
    if (dir) rmSync(dir, { recursive: true, force: true })
    await browser.close()
  }
})

// goal 0205 S4: a failed check must never read as "up to date" -- the
// fail seam short-circuits before any real network call, so this is
// deterministic and offline.
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('A failed automatic check renders honestly, never as up to date', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  let server: SpawnedServer | undefined
  let dir: string | undefined
  const browser = await chromium.launch()
  try {
    ;({ server, dir } = await spawnUpdatesServer(idx, UPDATES_AUTOCHECK_SERVER_BASE_PORT, UPDATES_AUTOCHECK_MCP_BASE_PORT, {
      MILL_TEST_UPDATE_FAKE_VERSION: '9.9.9',
      MILL_TEST_UPDATE_CHECK_FAIL: '1',
    }))
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Settings' }).click()

    await expect(page.getByTestId('update-check-error')).toBeVisible()
    await expect(page.getByTestId('update-check-error-copy')).toBeVisible()
    await expect(page.getByTestId('last-check-failed')).toBeVisible()
    await expect(page.getByTestId('last-check-failed-copy')).toBeVisible()

    // Never the up-to-date reading, and never the available-update card.
    await expect(page.locator('body')).not.toContainText("You're on the latest version")
    await expect(page.getByTestId('update-available-card')).toHaveCount(0)
    await expect(page.getByTestId('last-check-status')).toHaveCount(0)

    await page.close()
  } finally {
    await server?.stop()
    if (dir) rmSync(dir, { recursive: true, force: true })
    await browser.close()
  }
})
