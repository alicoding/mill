import { chromium, expect, test } from '@playwright/test'
import { rmSync } from 'node:fs'
import {
  spawnUpdatesServer,
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
// State-unified goal 0220 S1: Settings and the footer pill both render
// SettingsService.UpdateNoticeState().state, ONE derived enum, off the
// same primary-action testid ("update-primary-action" in Settings,
// state-named testids on the pill) -- no more separate check-for-
// updates/update-now/restart-mill elements. Every channel renders from
// the same binary, distinguished only by MILL_TEST_UPDATE_CHANNEL -- a
// real release/beta-channel build is stamped at compile time (main.go's
// millChannel, ldflags-overridden by release.yml/ci.yml's beta-release
// job), so proving every branch of the UI needs this env seam instead.
// MILL_TEST_UPDATE_FAKE_VERSION makes CheckForUpdates return a canned
// "update available" result with no network call; its own
// DownloadAndInstallUpdate always refuses ("no release asset in test
// mode") rather than reaching a real updater -- deliberate for the
// available/downloading/error states below, but it means the "a staged
// update is never sacred" SUPERSEDE transition (goal 0220 S1 item 6)
// can't be reached from here at all: fake mode never calls the real
// wails/v3 pkg/updater whose discardStaging() behavior that rule
// depends on. That transition (and its failure fallback) is proven at
// the Go integration level instead
// (internal/services/settingssvc/settingsservice_updatestate_test.go's
// TestDownloadAndInstallUpdate_FailedSupersedeSurfacesCheckErrorAndClearsReadiness),
// against a real *updater.Updater with a fake host/provider pair.
// Deliberately bypasses the standard per-worker fixture (same
// reasoning as persistence.spec.ts): each test needs its own server
// carrying a fixed MILL_TEST_UPDATE_* env for its whole lifetime, on
// its own disjoint port pair.

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Source-channel build never offers to download, and shows the pull-and-rebuild instructions', async ({}, testInfo) => {
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

    // A source build's ONE primary action always stays "Check for
    // updates" -- it can find a newer version but can never offer to
    // install it (goal 0220 S1: state=available is only reachable when
    // the channel can install).
    const primary = page.getByTestId('update-primary-action')
    await expect(primary).toHaveText('Check for updates')
    await primary.click()
    await expect(primary).toHaveText('Check for updates')

    await page.close()
  } finally {
    await server?.stop()
    if (dir) rmSync(dir, { recursive: true, force: true })
    await browser.close()
  }
})

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Release-channel build offers to download, and a failed install surfaces the browser fallback', async ({}, testInfo) => {
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

    const card = page.getByTestId('update-available-card')
    await expect(card).toBeVisible()

    // The primary action's label IS the next state action (goal 0220
    // S1 item 2): idle -> available carries the version.
    const primary = page.getByTestId('update-primary-action')
    await expect(primary).toHaveText('Download v9.9.9 and install')
    await expect(card).not.toContainText('This copy was built from source')

    // A failed install (fake mode always refuses, standing in for the
    // real blocked-network 403 class) surfaces the browser-download
    // escape hatch inside the card, not just the raw error -- and the
    // primary action offers an immediate retry rather than dead-ending.
    await primary.click()
    await expect(card).toContainText("Couldn't install the update")
    await expect(card).toContainText('Get the update with your browser instead')
    await expect(card.getByTestId('open-releases-page')).toBeVisible()
    // goal 0127: the failure carries a copyable diagnosis.
    await expect(card.getByTestId('update-error-copy')).toBeVisible()
    await expect(primary).toHaveText('Download v9.9.9 and install')

    await page.close()
  } finally {
    await server?.stop()
    if (dir) rmSync(dir, { recursive: true, force: true })
    await browser.close()
  }
})

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Beta-channel build offers to download, dismissing the pill leaves the action reachable in Settings', async ({}, testInfo) => {
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

    const card = page.getByTestId('update-available-card')
    await expect(card).toBeVisible()
    const primary = page.getByTestId('update-primary-action')
    await expect(primary).toHaveText('Download v9.9.9 and install')
    await expect(card).not.toContainText('This copy was built from source')

    // goal 0122: the check also lights the footer notice pill, agreeing
    // with Settings (goal 0220 S1's "pill and page can never disagree"
    // acceptance criterion); dismiss hides it for THIS version and
    // survives a reload.
    await expect(page.getByTestId('notice-update-available')).toBeVisible()
    await page.getByTestId('notice-dismiss').click()
    await expect(page.getByTestId('notice-update-available')).toHaveCount(0)
    await page.reload()
    await page.getByRole('link', { name: 'Settings' }).click()

    // Dismissing the pill must never also hide the action from Settings
    // (goal 0220 S1 item 3) -- the auto-check-on-open finds the same
    // version again and Settings offers it, while the pill (dismissal-
    // aware) stays hidden.
    await expect(page.getByTestId('update-available-card')).toBeVisible()
    await expect(page.getByTestId('update-primary-action')).toHaveText('Download v9.9.9 and install')
    await expect(page.getByTestId('notice-update-available')).toHaveCount(0)

    // Auto-check opt-in persists (default off); the interval select
    // only appears once it's on, defaulting to Hourly.
    const auto = page.getByTestId('auto-update-check')
    await expect(auto).not.toBeChecked()
    await expect(page.getByTestId('update-check-interval-select')).toHaveCount(0)
    await auto.check()
    await expect(page.getByTestId('update-check-interval-select')).toHaveValue('hourly')
    await page.reload()
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByTestId('auto-update-check')).toBeChecked()
    await expect(page.getByTestId('update-check-interval-select')).toHaveValue('hourly')

    await page.close()
  } finally {
    await server?.stop()
    if (dir) rmSync(dir, { recursive: true, force: true })
    await browser.close()
  }
})

// goal 0122: the ready state renders the accent relaunch pill --
// forced via the MILL_TEST_UPDATE_READY seam (a real install can't run
// in e2e; the manual-only registry covers the live swap). goal 0220 S1:
// Settings' own primary action must show the SAME state.
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('An installed update shows the relaunch pill AND the matching Settings primary action', async ({}, testInfo) => {
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

    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByTestId('update-primary-action')).toHaveText('Restart to update')

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

    // No click on the primary action anywhere in this test -- the card
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
// the delay seam rather than racing a same-tick promise. goal 0220 S1:
// "checking" is now server state (SettingsService.UpdateNoticeState
// itself), so the ONE primary action reflects it, not a locally-tracked
// in-flight flag.
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('The primary action shows a checking state while the automatic check is in flight', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  let server: SpawnedServer | undefined
  let dir: string | undefined
  const browser = await chromium.launch()
  try {
    ;({ server, dir } = await spawnUpdatesServer(idx, UPDATES_AUTOCHECK_SERVER_BASE_PORT, UPDATES_AUTOCHECK_MCP_BASE_PORT, {
      MILL_TEST_UPDATE_FAKE_VERSION: '9.9.9',
      MILL_TEST_UPDATE_CHECK_DELAY_MS: '1500',
      // A release/beta channel is what can ever reach the "available"
      // primary-action label below -- a source build's own primary
      // action never leaves "Check for updates" (see the source-channel
      // test above), so this test needs an installable channel to prove
      // the transition, not just the checking phase itself.
      MILL_TEST_UPDATE_CHANNEL: 'release',
    }))
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Settings' }).click()

    const primary = page.getByTestId('update-primary-action')
    await expect(primary).toHaveText('Checking…')
    await expect(primary).toBeDisabled()
    await expect(page.getByTestId('update-available-card')).toHaveCount(0)

    // The delayed check lands, and the primary action follows the
    // state straight through to "available" -- the same element, a
    // new label, never a second button.
    await expect(page.getByTestId('update-available-card')).toBeVisible()
    await expect(primary).toBeEnabled()
    await expect(primary).toHaveText('Download v9.9.9 and install')

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
    // The primary action falls back to a retry, never a stuck "Checking…".
    await expect(page.getByTestId('update-primary-action')).toHaveText('Check for updates')

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
