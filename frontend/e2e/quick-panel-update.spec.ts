import { chromium, expect, test } from '@playwright/test'
import { rmSync } from 'node:fs'
import { spawnUpdatesServer, type SpawnedServer, UPDATES_QUICK_PANEL_MCP_BASE_PORT, UPDATES_QUICK_PANEL_SERVER_BASE_PORT } from './fixtures/server'

// goal 0222 S2: the Quick Panel's action rows now derive from the
// command registry (shared/quickPanelCommands.ts's quickPanelRowIds) --
// this proves the update pipeline's own quickPanel rows (shared/
// settingsCommands.ts) appear/disappear live off the SAME state door
// the pill and Settings' primary button already render off
// (updates-live-actions.spec.ts covers those two surfaces; this is the
// panel's own). Dedicated server (testing.md): MILL_TEST_UPDATE_* env
// vars are fixed for the whole server lifetime, same as every other
// updates case.
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('the Quick Panel shows "Download the update and install" only once CheckForUpdates finds one, run from the panel itself', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  let server: SpawnedServer | undefined
  let dir: string | undefined
  const browser = await chromium.launch()
  try {
    ;({ server, dir } = await spawnUpdatesServer(idx, UPDATES_QUICK_PANEL_SERVER_BASE_PORT, UPDATES_QUICK_PANEL_MCP_BASE_PORT, {
      MILL_TEST_UPDATE_FAKE_VERSION: '9.9.9',
      MILL_TEST_UPDATE_CHANNEL: 'release',
    }))
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/#/quickpanel`)
    const search = page.getByRole('combobox', { name: 'Quick Panel search' })
    await expect(search).toBeFocused()

    // Nothing has checked yet (unlike Settings' own mount-time
    // auto-check, goal 0205 S4 -- the panel never checks on its own) --
    // update.downloadAndInstall's row is absent (the query still always
    // renders its own "Save as note" fallback row, goal 0090, so this
    // asserts the NAMED option's absence, not a bare zero count),
    // update.check's row is there, ready to run the exact same check
    // Settings would.
    await search.fill('Download the update and install')
    await expect(page.getByRole('option', { name: 'Download the update and install' })).toHaveCount(0)
    // goal 0295: the user's own word ranks the command first -- above
    // the seeded "Notify when an update is available" workflow, which
    // merely contains it -- so Enter means "check", never "run".
    await search.fill('update')
    await expect(page.getByRole('option').first()).toHaveText(/Check for updates/)
    const checkOption = page.getByRole('option', { name: 'Check for updates' })
    await expect(checkOption).toBeVisible()
    await checkOption.click()

    // The check runs server-side and pushes update-notice over
    // mill-data-changed -- the panel's own live listener (app/
    // QuickPanel.tsx) re-derives its rows with no reload, same as the
    // pill's own live subscription. The footer says what happened and
    // names the next row (goal 0295).
    await expect(page.getByTestId('quick-panel-status')).toHaveText('Mill 9.9.9 is available — run "Download the update and install"', { timeout: 10_000 })
    // One update door at a time: the check row yields to the download row.
    await search.fill('update')
    await expect(page.getByRole('option').first()).toHaveText(/Download the update and install/)
    await expect(page.getByRole('option', { name: 'Check for updates' })).toHaveCount(0)
    await search.fill('Download the update and install')
    await expect(page.getByRole('option', { name: 'Download the update and install' })).toBeVisible({ timeout: 10_000 })

    await page.close()
  } finally {
    await server?.stop()
    if (dir) rmSync(dir, { recursive: true, force: true })
    await browser.close()
  }
})
