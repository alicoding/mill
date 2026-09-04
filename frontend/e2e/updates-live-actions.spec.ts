import { chromium, expect, test } from '@playwright/test'
import { openSettings } from './fixtures/settingsNav'
import { rmSync } from 'node:fs'
import {
  spawnUpdatesServer,
  type SpawnedServer,
  UPDATES_AUTODOWNLOAD_MCP_BASE_PORT,
  UPDATES_AUTODOWNLOAD_SERVER_BASE_PORT,
  UPDATES_PILL_ACTION_MCP_BASE_PORT,
  UPDATES_PILL_ACTION_SERVER_BASE_PORT,
} from './fixtures/server'

// Split from updates.spec.ts at the 500-line convention (architecture.md)
// -- the two cases here specifically prove a state TRANSITION happening
// live, driven by the background auto-download loop or a real pill
// click, rather than a single static state render. Same header
// reasoning as updates.spec.ts: MILL_TEST_UPDATE_FAKE_VERSION/
// MILL_TEST_UPDATE_CHANNEL/MILL_TEST_UPDATE_DOWNLOAD_DELAY_MS/
// MILL_TEST_AUTO_UPDATE_LOOP_DELAY_MS are all env seams a spawned
// server carries for its whole lifetime, so each test gets its own
// dedicated server on its own disjoint port pair (spawnUpdatesServer,
// promoted to fixtures/server.ts once this file needed it too).

// goal 0207: enabling the auto-download opt-in must start downloading a
// found update immediately, live -- no restart, and no separate click
// on the primary action. MILL_TEST_AUTO_UPDATE_LOOP_DELAY_MS shrinks the
// background loop's gentle-timing initial wait so the toggle's first
// check runs within the test's own timeout; MILL_TEST_UPDATE_DOWNLOAD_
// DELAY_MS holds fake mode's refusal open long enough to observe the
// Downloading phase the notice machinery already exposes (the primary
// action's own label/disabled state -- server truth, not a click
// result).
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Enabling auto-download starts a background download live, with no click on the primary action', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  let server: SpawnedServer | undefined
  let dir: string | undefined
  const browser = await chromium.launch()
  try {
    ;({ server, dir } = await spawnUpdatesServer(idx, UPDATES_AUTODOWNLOAD_SERVER_BASE_PORT, UPDATES_AUTODOWNLOAD_MCP_BASE_PORT, {
      MILL_TEST_UPDATE_FAKE_VERSION: '9.9.9',
      MILL_TEST_UPDATE_CHANNEL: 'release',
      MILL_TEST_AUTO_UPDATE_LOOP_DELAY_MS: '100',
      MILL_TEST_UPDATE_DOWNLOAD_DELAY_MS: '2000',
    }))
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await openSettings(page, 'updates')

    // The mount-time check (goal 0205 S4) already found the update, but
    // the opt-in is still off -- no download must start from it.
    await expect(page.getByTestId('update-available-card')).toBeVisible()
    const primary = page.getByTestId('update-primary-action')
    await expect(primary).toHaveText('Download v9.9.9 and install')

    // Enabling the toggle is the ONLY action this test takes from here
    // -- the live loop's own next check must find the same version and
    // feed the download chain automatically.
    await page.getByTestId('auto-update-check').check()

    await expect(primary).toHaveText('Downloading update…')
    await expect(primary).toBeDisabled()

    await page.close()
  } finally {
    await server?.stop()
    if (dir) rmSync(dir, { recursive: true, force: true })
    await browser.close()
  }
})

// goal 0220 S1 items 3+5: the pill ACTS, never navigates -- clicking
// its available-state row runs update.downloadAndInstall directly (the
// exact command Settings' own primary action runs), switching the pill
// itself into a progress badge. MILL_TEST_UPDATE_DOWNLOAD_DELAY_MS holds
// fake mode's eventual refusal open long enough to observe the
// downloading phase deterministically.
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test("Clicking the pill's available notice starts the download directly, never navigating to Settings", async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  let server: SpawnedServer | undefined
  let dir: string | undefined
  const browser = await chromium.launch()
  try {
    ;({ server, dir } = await spawnUpdatesServer(idx, UPDATES_PILL_ACTION_SERVER_BASE_PORT, UPDATES_PILL_ACTION_MCP_BASE_PORT, {
      MILL_TEST_UPDATE_FAKE_VERSION: '9.9.9',
      MILL_TEST_UPDATE_CHANNEL: 'release',
      MILL_TEST_UPDATE_DOWNLOAD_DELAY_MS: '2000',
    }))
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    // Settings' own mount-time check (goal 0205 S4) is what actually
    // populates server state -- the pill itself never initiates a
    // check, it only ever renders whatever UpdateNoticeState reports.
    await openSettings(page, 'updates')
    await expect(page.getByTestId('update-available-card')).toBeVisible()

    const pillAvailable = page.getByTestId('notice-update-available')
    await expect(pillAvailable).toBeVisible()
    await pillAvailable.getByText('Update available — download').click()

    // Acting, not navigating: the view never changes (still on
    // Settings, where this test already was), and the pill itself
    // switches straight into a progress badge.
    await expect(page.getByTestId('notice-update-downloading')).toBeVisible()
    await expect(page.getByTestId('settings-view')).toBeVisible()

    // Settings' own primary action agrees with the pill (goal 0220 S1's
    // "pill and page can never disagree" acceptance criterion) --
    // both surfaces render the one state machine.
    await expect(page.getByTestId('update-primary-action')).toHaveText('Downloading update…')
    await expect(page.getByTestId('update-primary-action')).toBeDisabled()

    await page.close()
  } finally {
    await server?.stop()
    if (dir) rmSync(dir, { recursive: true, force: true })
    await browser.close()
  }
})
