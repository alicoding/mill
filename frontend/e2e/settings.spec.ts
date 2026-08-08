import { test, expect } from '@playwright/test'

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
