import { test, expect, MCP_BASE_PORT } from './fixtures/server'
import { existsSync, readdirSync } from 'node:fs'
import { openSettings } from './fixtures/settingsNav'

// Exercises docs/SPEC.md §3.7's two new global settings (launch at
// login, global summon hotkey) over real Go bindings (Wails3 server
// mode), not mocks -- same "assert the environment-independent path"
// discipline every other clipboard/hotkey-touching spec in this repo
// already uses. Server mode's binary isn't a real .app bundle
// (appBundlePath returns launchatlogin.ErrNotAppBundle for a bare
// executable path), and the hotkey adapter's own server build tag
// stubs out real OS registration entirely (hotkey_server.go) -- both
// deterministic, real error paths, not skipped/mocked.

test('Settings opens on a group pane, and Shortcuts carries the global hotkey', async ({ page }) => {
  await page.goto('/')
  await openSettings(page, 'general')
  await expect(page.getByRole('heading', { name: 'General', level: 1 })).toBeVisible()
  await expect(page.getByText('Launch Mill at login')).toBeVisible()
  // One pane at a time (goal 0321): the global hotkey is NOT on
  // General, it is a row of the Shortcuts pane.
  await expect(page.getByTestId('set-summon-hotkey')).toHaveCount(0)

  await openSettings(page, 'shortcuts')
  await expect(page.getByRole('heading', { name: 'Shortcuts', level: 1 })).toBeVisible()
  await expect(page.getByTestId('set-summon-hotkey')).toBeVisible()
})

// docs/adr/0035: the forward-refactor proof's Settings half --
// ForwardPendingApproval's private send path and its own Settings
// section (checkbox + request picker) are deleted, replaced by the
// seeded "Forward approvals to the sponsor" workflow (proven in
// seed-completeness.spec.ts). This is the negative half: the old
// section must actually be GONE, not just unused.
test('Settings no longer shows the Forward pending approvals section', async ({ page }) => {
  await page.goto('/')
  await openSettings(page, 'general')
  await expect(page.getByTestId('settings-view')).toBeVisible()
  await expect(page.getByText('Forward pending approvals')).toHaveCount(0)
  await expect(page.getByTestId('forward-approvals-enabled-checkbox')).toHaveCount(0)
})

test('Launch at login checkbox reflects the real server-mode error', async ({ page }) => {
  await page.goto('/')
  await openSettings(page, 'general')

  const checkbox = page.getByTestId('launch-at-login-checkbox')
  await expect(checkbox).toBeVisible()
  // internal/adapters/launchatlogin's server build tag
  // (launchatlogin_server.go) stubs out every function with
  // ErrUnsupportedInServerMode -- a real, deterministic error in the
  // e2e environment (server mode), distinct from the desktop dev-binary
  // case (ErrNotAppBundle) the pane also handles. The switch cannot
  // reflect a state Mill could not read, so it stays disabled and the
  // line beneath it says which case this is.
  await expect(page.getByText(/not available in server mode/i)).toBeVisible()
  await expect(checkbox).toBeDisabled()
})

test('Setting a global summon hotkey shows the recording state', async ({ page }) => {
  await page.goto('/')
  await openSettings(page, 'shortcuts')

  await page.getByTestId('set-summon-hotkey').click()
  await expect(page.getByText(/press a combo/i)).toBeVisible()

  // Escape cancels recording without calling AssignSummonHotkey at all
  // -- deterministic regardless of server-mode's real hotkey stub.
  await page.keyboard.press('Escape')
  await expect(page.getByText(/press a combo/i)).not.toBeVisible()
  await expect(page.getByTestId('set-summon-hotkey')).toBeVisible()
})

test('Check for updates produces a visible status, found or error', async ({ page }) => {
  await page.goto('/')
  await openSettings(page, 'updates')

  // A real call to the GitHub Releases provider (alicoding/mill has no
  // releases yet) -- deterministic either way in this environment
  // (no network in a sandboxed runner, or a real "no releases" 404):
  // the check can never resolve to "available" here, so the ONE
  // primary action (goal 0220 S1) always settles back to its idle
  // label, never "Download vX and install" -- only the button's own
  // round-trip (re-enables once done) is asserted, not which specific
  // outcome text a real network call happens to produce.
  const button = page.getByTestId('update-primary-action')
  await button.click()
  await expect(button).toBeEnabled({ timeout: 15_000 })
  await expect(button).toHaveText('Check for updates')
})

// Every worker's own spawned server sets MILL_MCP_ADDR for port
// isolation (fixtures/server.ts) -- an env override is therefore
// always active in this shared pool, which proves exactly the
// read-only display state settingsservice_mcpaddr.go's ResolveMCPAddr
// produces when the env wins. The editable/save/validate path is
// unreachable here for the same reason and is named in
// .claude/rules/testing.md's manual-only registry instead.
test('MCP access address field shows the active environment override read-only', async ({ page }, testInfo) => {
  await page.goto('/')
  await openSettings(page, 'connections')

  const input = page.getByTestId('mcp-access-address-input')
  await expect(input).toBeVisible()
  await expect(input).toBeDisabled()
  await expect(input).toHaveValue(`127.0.0.1:${MCP_BASE_PORT + testInfo.parallelIndex}`)
  await expect(page.getByText(/MILL_MCP_ADDR environment variable/)).toBeVisible()
  await expect(page.getByTestId('mcp-access-address-save')).toHaveCount(0)
})

test('MCP write gate toggles from Settings and persists across a reload', async ({ page }) => {
  await page.goto('/')
  await openSettings(page, 'connections')

  const checkbox = page.getByTestId('mcp-write-enabled-checkbox')
  await expect(checkbox).toBeEnabled()
  // Default off (docs/adr/0017) -- the shared e2e settings file could
  // carry a previous run's value, so normalize to off first, then
  // round-trip on -> reload -> still on -> restore off (leaving the
  // shared file the way a fresh install would look, per
  // .claude/rules/testing.md's cleanup discipline).
  if (await checkbox.isChecked()) {
    await checkbox.click()
    await expect(checkbox).not.toBeChecked()
  }

  await checkbox.click()
  await expect(checkbox).toBeChecked()

  await page.reload()
  await openSettings(page, 'connections')
  const afterReload = page.getByTestId('mcp-write-enabled-checkbox')
  await expect(afterReload).toBeChecked()

  await afterReload.click()
  await expect(afterReload).not.toBeChecked()
})

// docs/goals/0065: data-stewardship's own e2e proof -- Back up now (a
// real VACUUM INTO snapshot lands under this worker's own isolated
// backupDir, MILL_BACKUP_DIR-pointed per fixtures/server.ts), export-
// everything produces a genuine archive, and importing it back shows
// the preview/confirm bar before anything is applied.
test('Back up now takes a snapshot and updates the last-backup time', async ({ page, workerServer }) => {
  await page.goto('/')
  await openSettings(page, 'backups')

  const button = page.getByTestId('backup-now')
  await expect(button).toBeVisible()
  await button.click()
  await expect(button).toBeEnabled({ timeout: 15_000 })
  await expect(page.getByText(/Last backup:/)).toBeVisible()

  const entries = existsSync(workerServer.backupDir) ? readdirSync(workerServer.backupDir) : []
  expect(entries.length).toBeGreaterThan(0)
})

// Goal 0071 G18: the palette's "Back up now" command performs a real
// backup through the exact same BackupService.BackupNow RPC the
// Settings button above already proves against a real snapshot file --
// this proves the command reaches it too, live-updating an ALREADY-OPEN
// Settings page via the same mill-data-changed{entity:"backup"} event
// the button's own click already relies on (DataStewardshipSection.tsx),
// without ever touching that button.
test('Back up now from the command palette takes a real snapshot, live-updating an open Settings page', async ({ page, workerServer }) => {
  await page.goto('/')
  await openSettings(page, 'backups')
  await expect(page.getByTestId('backup-now')).toBeVisible()

  const before = existsSync(workerServer.backupDir) ? readdirSync(workerServer.backupDir).length : 0

  await page.keyboard.press('Meta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await palette.getByRole('combobox').fill('Back up now')
  await expect(page.getByRole('option', { name: 'Back up now' })).toBeVisible()
  await page.getByRole('option', { name: 'Back up now' }).click()

  await expect(page.getByText(/Last backup:/)).toBeVisible({ timeout: 15_000 })
  const after = existsSync(workerServer.backupDir) ? readdirSync(workerServer.backupDir).length : 0
  expect(after).toBeGreaterThan(before)
})

// "Export everything" deep-links to Settings rather than downloading
// directly -- the flow needs its own confirm/download UI there
// (DataStewardshipSection.tsx), same reasoning every settings.open.*
// deep-link command already follows.
test('Export everything from the command palette lands on the Backups pane', async ({ page }) => {
  await page.goto('/')
  // The shell paints after a short async boot (plugins load first --
  // docs/goals/0249); a keypress before anything is visible is not a
  // user primitive, so the first press waits for the painted nav.
  await expect(page.getByTestId('sidebar-nav')).toBeVisible()
  await page.keyboard.press('Meta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await palette.getByRole('combobox').fill('Export everything')
  await expect(page.getByRole('option', { name: 'Export everything' })).toBeVisible()
  await page.getByRole('option', { name: 'Export everything' }).click()

  await expect(page.getByTestId('settings-view')).toBeVisible()
  await expect(page.getByTestId('settings-pane-backups')).toBeVisible()
  await expect(page.getByTestId('export-everything')).toBeVisible()
})

test('Export everything downloads a genuine zip archive', async ({ page }) => {
  await page.goto('/')
  await openSettings(page, 'backups')

  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('export-everything').click()
  const download = await downloadPromise

  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const data = Buffer.concat(chunks)

  expect(data.length).toBeGreaterThan(0)
  // A zip file's own local-file-header signature (PK\x03\x04) --
  // confirms this is a real archive, not an error page or empty file.
  expect(data.subarray(0, 2).toString('latin1')).toBe('PK')
})

test('Importing an export-everything archive shows a preview before applying', async ({ page }) => {
  await page.goto('/')
  await openSettings(page, 'backups')

  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('export-everything').click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const archiveBuffer = Buffer.concat(chunks)

  await page.getByTestId('import-everything').click()
  await page.getByTestId('import-everything-input').setInputFiles({
    name: 'mill-backup.zip',
    mimeType: 'application/zip',
    buffer: archiveBuffer,
  })

  await expect(page.getByText('Import this backup?')).toBeVisible()
  // Re-importing this instance's own just-taken export finds every
  // bundled entity already present locally -- an all-Updated preview,
  // never a Created one.
  await expect(page.getByText(/updated/)).toBeVisible()

  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('Import this backup?')).not.toBeVisible()
})

// goal 0321: the group-list / one-pane-at-a-time contract. Default
// Playwright viewport (1280x720) is well above the narrow breakpoint
// (useNarrowViewport.ts's own 767px), so the group list renders with
// no extra viewport setup.

test('The group list shows exactly one pane, marks it, and routes to it', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByTestId('settings-view')).toBeVisible()

  const nav = page.getByTestId('settings-group-nav')
  await expect(nav).toBeVisible()
  // The filter box is gone: with one pane showing there is nothing on
  // screen for a filter to narrow.
  await expect(page.getByTestId('settings-filter')).toHaveCount(0)

  await page.getByTestId('settings-group-item-appearance').click()
  await expect(page.getByTestId('settings-pane-appearance')).toBeVisible()
  await expect(page.getByTestId('settings-group-item-appearance')).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveURL(/#\/settings\/appearance$/)

  // ONLY Appearance renders -- every other pane's own controls are
  // unmounted, not merely scrolled away.
  await expect(page.getByTestId('light-scheme-select')).toBeVisible()
  await expect(page.getByTestId('launch-at-login-checkbox')).toHaveCount(0)
  await expect(page.getByTestId('backup-now')).toHaveCount(0)
  await expect(page.getByTestId('settings-pane-general')).toHaveCount(0)

  // Match system is the default mode, so both families are listed and
  // each list is NAMED for the appearance it is for.
  await expect(page.getByRole('listbox', { name: 'Light theme' })).toBeVisible()
  await expect(page.getByRole('listbox', { name: 'Dark theme' })).toBeVisible()

  await page.getByTestId('settings-group-item-backups').click()
  await expect(page.getByTestId('settings-pane-backups')).toBeVisible()
  await expect(page.getByTestId('settings-group-item-appearance')).not.toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('light-scheme-select')).toHaveCount(0)
})

test('Connections gathers MCP access, Remote access and Contract in reach order', async ({ page }) => {
  await page.goto('/')
  await openSettings(page, 'connections')

  const headings = page.getByTestId('settings-pane-connections').getByTestId('settings-section-heading')
  await expect(headings).toHaveText(['MCP access', 'Remote access', 'Contract'])
  await expect(page.getByTestId('mcp-access-address-input')).toBeVisible()
  await expect(page.getByTestId('export-contract')).toBeVisible()
})

test('A #/settings/<group> address lands on that pane on a fresh load', async ({ page }) => {
  await page.goto('/#/settings/notifications')
  await expect(page.getByTestId('settings-view')).toBeVisible()
  await expect(page.getByTestId('settings-pane-notifications')).toBeVisible()
  await expect(page.getByTestId('attention-idle-threshold-input')).toBeVisible()
})

test('Palette "Settings > Backups" deep-links straight to the pane', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  await page.keyboard.press('Meta+k')
  const dialog = page.getByRole('dialog', { name: 'Command palette' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('combobox').fill('Backups')

  const option = dialog.getByRole('option', { name: /Settings › Backups/ })
  await expect(option).toBeVisible()
  await option.click()
  await expect(dialog).toHaveCount(0)

  await expect(page.getByTestId('settings-view')).toBeVisible()
  await expect(page.getByTestId('settings-pane-backups')).toBeVisible()
  await expect(page.getByTestId('backup-now')).toBeVisible()
})
