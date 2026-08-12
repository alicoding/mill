import { test, expect } from './fixtures/server'

// Exercises docs/SPEC.md §3.7's two new global settings (launch at
// login, global summon hotkey) over real Go bindings (Wails3 server
// mode), not mocks -- same "assert the environment-independent path"
// discipline every other clipboard/hotkey-touching spec in this repo
// already uses. Server mode's binary isn't a real .app bundle
// (appBundlePath returns launchatlogin.ErrNotAppBundle for a bare
// executable path), and the hotkey adapter's own server build tag
// stubs out real OS registration entirely (hotkey_server.go) -- both
// deterministic, real error paths, not skipped/mocked.

test('Settings page shows Launch at login and Global hotkey sections', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByTestId('settings-view')).toBeVisible()
  await expect(page.getByText('Launch Mill at login')).toBeVisible()
  await expect(page.getByText('Global hotkey')).toBeVisible()
})

// docs/adr/0035: the forward-refactor proof's Settings half --
// ForwardPendingApproval's private send path and its own Settings
// section (checkbox + request picker) are deleted, replaced by the
// seeded "Example: Forward pending approvals" workflow (proven in
// seed-completeness.spec.ts). This is the negative half: the old
// section must actually be GONE, not just unused.
test('Settings no longer shows the Forward pending approvals section', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByTestId('settings-view')).toBeVisible()
  await expect(page.getByText('Forward pending approvals')).toHaveCount(0)
  await expect(page.getByTestId('forward-approvals-enabled-checkbox')).toHaveCount(0)
})

test('Launch at login checkbox reflects the real server-mode error', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()

  const checkbox = page.getByTestId('launch-at-login-checkbox')
  await expect(checkbox).toBeVisible()
  // internal/adapters/launchatlogin's server build tag
  // (launchatlogin_server.go) stubs out every function with
  // ErrUnsupportedInServerMode -- a real, deterministic error in the
  // e2e environment (server mode), distinct from the desktop dev-binary
  // case (ErrNotAppBundle) SettingsView.tsx also handles.
  await checkbox.click()
  await expect(page.getByText(/not available in server mode/i)).toBeVisible()
})

test('Setting a global summon hotkey shows the recording state', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()

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
  await page.getByRole('button', { name: 'Settings' }).click()

  // A real call to the GitHub Releases provider (alicoding/mill has no
  // releases yet) -- deterministic either way in this environment
  // (no network in a sandboxed runner, or a real "no releases" 404),
  // so only the button's own round-trip (re-enables once done) is
  // asserted, not which specific outcome text appears.
  const button = page.getByTestId('check-for-updates')
  await button.click()
  await expect(button).toBeEnabled({ timeout: 15_000 })
  await expect(button).toHaveText('Check for updates')
})

test('MCP write gate toggles from Settings and persists across a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()

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
  await page.getByRole('button', { name: 'Settings' }).click()
  const afterReload = page.getByTestId('mcp-write-enabled-checkbox')
  await expect(afterReload).toBeChecked()

  await afterReload.click()
  await expect(afterReload).not.toBeChecked()
})
