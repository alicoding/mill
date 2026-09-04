import { chromium, expect, test } from '@playwright/test'
import { rmSync } from 'node:fs'
import {
  spawnUpdatesServer,
  type SpawnedServer,
  UPDATES_WHATSNEW_EMPTY_MCP_BASE_PORT,
  UPDATES_WHATSNEW_EMPTY_SERVER_BASE_PORT,
  UPDATES_WHATSNEW_NOTES_MCP_BASE_PORT,
  UPDATES_WHATSNEW_NOTES_SERVER_BASE_PORT,
} from './fixtures/server'
import { paletteDialog } from './fixtures/palette'
import { openSettings } from './fixtures/settingsNav'

// The What's-new changelog surface (goal 0220 S2), split from
// updates.spec.ts along its own dedicated port pairs. updates.spec.ts's
// header carries the shared reasoning for this family: every test
// spawns its OWN server (bypassing the per-worker fixture, same as
// persistence.spec.ts) because each needs a fixed MILL_TEST_UPDATE_*
// env for its whole lifetime on a disjoint port pair.

// Command-first (0222): before any check has ever run, update.whatsNew
// is still reachable via the palette (no Settings visit, no pill) and
// shows the honest empty state with its own action beside it, never a
// dead-end sentence (ux-writing.md's "an empty state offers the action
// it names"). No MILL_TEST_UPDATE_FAKE_VERSION here on purpose --
// opening Settings would fire a real (offline-failing) check via its
// own auto-check-on-open effect, so this test never navigates there.
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test("What's new is reachable from the palette before any check has run, and its empty state offers the check action", async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  let server: SpawnedServer | undefined
  let dir: string | undefined
  const browser = await chromium.launch()
  try {
    ;({ server, dir } = await spawnUpdatesServer(idx, UPDATES_WHATSNEW_EMPTY_SERVER_BASE_PORT, UPDATES_WHATSNEW_EMPTY_MCP_BASE_PORT, {}))
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)

    // A keydown before the app's keymap mounts is dropped silently; the
    // first press waits for the painted nav (command-palette.spec.ts's
    // own convention for the first Meta+k after goto).
    await expect(page.getByTestId('sidebar-nav')).toBeVisible()
    await page.keyboard.press('Meta+k')
    await expect(paletteDialog(page)).toBeVisible()
    await paletteDialog(page).getByRole('combobox').fill("What's new")
    await paletteDialog(page).getByRole('option', { name: "What's new", exact: true }).click()
    await expect(paletteDialog(page)).toHaveCount(0)

    const dialog = page.getByRole('dialog', { name: "What's new" })
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('whats-new-empty')).toContainText(
      'Release notes appear here after an update check finds a new version.',
    )
    await expect(page.getByTestId('whats-new-check')).toBeVisible()
    await expect(page.getByTestId('whats-new-notes')).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await page.close()
  } finally {
    await server?.stop()
    if (dir) rmSync(dir, { recursive: true, force: true })
    await browser.close()
  }
})

// The changelog surface's other half: once a check has found notes,
// BOTH entry points (the pill's secondary link and Settings' own link)
// open the exact same dialog rendering the exact same server-rendered
// markdown -- real elements, not literal markdown characters, and the
// manual-install tail stays trimmed the same way the old raw-text card
// already proved (goal 0127).
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test("The pill's secondary link and Settings' own link both open What's new, rendering the notes as real markdown", async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  let server: SpawnedServer | undefined
  let dir: string | undefined
  const browser = await chromium.launch()
  try {
    ;({ server, dir } = await spawnUpdatesServer(idx, UPDATES_WHATSNEW_NOTES_SERVER_BASE_PORT, UPDATES_WHATSNEW_NOTES_MCP_BASE_PORT, {
      MILL_TEST_UPDATE_FAKE_VERSION: '9.9.9',
      MILL_TEST_UPDATE_CHANNEL: 'release',
    }))
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    // Settings' own auto-check-on-open (goal 0205 S4) is what actually
    // runs the fake check here -- the same path the updates.spec.ts
    // family relies on to light the pill.
    await openSettings(page, 'updates')
    await expect(page.getByTestId('update-available-card')).toBeVisible()

    await page.getByTestId('notice-whats-new').click()
    const dialog = page.getByRole('dialog', { name: "What's new" })
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('whats-new-version')).toContainText('9.9.9')
    const notes = page.getByTestId('whats-new-notes')
    await expect(notes.locator('li')).toHaveText(['Fake note one', 'Fake note two'])
    // goal 0127: the manual-install tail past the marker never renders
    // in-app, proven here through the real render path (an <li>, not
    // pre-wrap text).
    await expect(notes).not.toContainText('xattr')
    await expect(notes).not.toContainText('Manual install')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    // Settings' own link opens the identical dialog -- one surface,
    // two doors.
    await page.getByTestId('open-whats-new').click()
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('whats-new-version')).toContainText('9.9.9')
    await expect(notes.locator('li')).toHaveText(['Fake note one', 'Fake note two'])

    await page.close()
  } finally {
    await server?.stop()
    if (dir) rmSync(dir, { recursive: true, force: true })
    await browser.close()
  }
})
