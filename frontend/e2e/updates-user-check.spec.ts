import { chromium, expect, test } from '@playwright/test'
import { rmSync } from 'node:fs'
import {
  spawnUpdatesServer,
  type SpawnedServer,
  UPDATES_USERCHECK_UPTODATE_MCP_BASE_PORT,
  UPDATES_USERCHECK_UPTODATE_SERVER_BASE_PORT,
  UPDATES_USERCHECK_FAIL_MCP_BASE_PORT,
  UPDATES_USERCHECK_FAIL_SERVER_BASE_PORT,
} from './fixtures/server'
import { paletteDialog } from './fixtures/palette'

// A user-run update check always answers (goal 0275): update.check's
// run() used to be fire-and-forget, so a palette check that found
// nothing was pure silence. These tests
// drive the REAL palette command and assert the footer pill's
// outcomes. Dedicated servers per test (updates.spec.ts's own
// reasoning: a fixed MILL_TEST_UPDATE_* env for the whole lifetime).

// runPaletteCheck opens the palette exactly as a user does and runs
// "Check for updates".
async function runPaletteCheck(page: import('@playwright/test').Page): Promise<void> {
  // A keydown before the app's keymap mounts is dropped silently; the
  // first press waits for the painted nav (command-palette.spec.ts's
  // own convention).
  await expect(page.getByTestId('sidebar-nav')).toBeVisible()
  await page.keyboard.press('Meta+k')
  await expect(paletteDialog(page)).toBeVisible()
  await paletteDialog(page).getByRole('combobox').fill('Check for updates')
  await paletteDialog(page).getByRole('option', { name: 'Check for updates', exact: true }).click()
  await expect(paletteDialog(page)).toHaveCount(0)
}

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('a palette check with nothing new answers: checking, then up to date, then quiet', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  let server: SpawnedServer | undefined
  let dir: string | undefined
  const browser = await chromium.launch()
  try {
    ;({ server, dir } = await spawnUpdatesServer(idx, UPDATES_USERCHECK_UPTODATE_SERVER_BASE_PORT, UPDATES_USERCHECK_UPTODATE_MCP_BASE_PORT, {
      MILL_TEST_UPDATE_FAKE_VERSION: '9.9.9',
      MILL_TEST_UPDATE_UP_TO_DATE: '1',
      // Holds the checking state long enough to observe it -- the
      // fake check otherwise resolves same-tick.
      MILL_TEST_UPDATE_CHECK_DELAY_MS: '1200',
    }))
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)

    await runPaletteCheck(page)
    await expect(page.getByTestId('notice-update-checking')).toBeVisible()
    await expect(page.getByTestId('notice-update-uptodate')).toContainText("You're up to date.")
    // The confirmation is transient: it dismisses itself.
    await expect(page.getByTestId('notice-update-uptodate')).toHaveCount(0, { timeout: 10_000 })

    await page.close()
  } finally {
    await server?.stop()
    if (dir) rmSync(dir, { recursive: true, force: true })
    await browser.close()
  }
})

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('a failed palette check answers honestly, offers Settings, and dismisses on demand', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  let server: SpawnedServer | undefined
  let dir: string | undefined
  const browser = await chromium.launch()
  try {
    ;({ server, dir } = await spawnUpdatesServer(idx, UPDATES_USERCHECK_FAIL_SERVER_BASE_PORT, UPDATES_USERCHECK_FAIL_MCP_BASE_PORT, {
      MILL_TEST_UPDATE_FAKE_VERSION: '9.9.9',
      MILL_TEST_UPDATE_CHECK_FAIL: '1',
    }))
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)

    await runPaletteCheck(page)
    const failed = page.getByTestId('notice-update-check-failed')
    await expect(failed).toBeVisible()
    await expect(failed).toContainText("Couldn't check for updates")
    // The notice is a door, not a dead end: its action opens Settings.
    await failed.getByRole('button', { name: /Couldn't check/ }).click()
    await expect(page.getByTestId('settings-view')).toBeVisible()
    // Dismiss clears it without waiting.
    await failed.getByTestId('notice-dismiss').click()
    await expect(failed).toHaveCount(0)

    await page.close()
  } finally {
    await server?.stop()
    if (dir) rmSync(dir, { recursive: true, force: true })
    await browser.close()
  }
})
