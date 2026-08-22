import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/server'

// seedTestDevice populates a paired device directly through
// RemoteAuthService.SeedTestDevice (methodID 341728691 in
// frontend/bindings/.../remoteauthservice.ts), the e2e-only seam
// gated by MILL_TEST_ALLOW_DEVICE_SEED (set for every worker server in
// fixtures/server.ts). A real pairing round trip only completes over a
// non-loopback connection, which this isolated per-worker server never
// has, so rename/last-seen coverage needs a paired row some other way
// -- posted straight to the Wails RPC endpoint (same wire shape
// @wailsio/runtime's Call.ByID uses) rather than through page JS, so
// this helper works whether or not the bindings module happens to be
// its own reachable chunk in a given build.
async function seedTestDevice(page: Page, label: string): Promise<{ id: string; label: string }> {
  const response = await page.request.post('/wails/runtime', {
    headers: { 'x-wails-client-id': 'e2e-seed', 'Content-Type': 'application/json' },
    data: {
      object: 0, // @wailsio/runtime objectNames.Call
      method: 0, // the Call object's CallBinding method
      args: { 'call-id': `e2e-seed-${label}`, methodID: 341728691, args: [label] },
    },
  })
  if (!response.ok()) {
    throw new Error(`seedTestDevice(${label}) failed: ${response.status()} ${await response.text()}`)
  }
  return response.json()
}

// docs/goals/0132-remote-access.md SLICE 1's own required proof: "an
// e2e proving the desktop (loopback) path is untouched". Every
// Playwright worker's server (e2e/fixtures/server.ts) is reached over
// 127.0.0.1 -- exactly the loopback connection
// remoteauthsvc.RemoteAuthService.Middleware must never challenge --
// so a normal page load reaching real app content, with no pairing
// page anywhere in between, is the desktop path's own regression
// test: a loopback break here would fail every spec in this suite,
// not just this one, but this test names the property directly rather
// than leaving it as an implicit side effect of "everything else still
// passes".
test('the desktop (loopback) path never sees the pairing page', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.status()).toBe(200)
  await expect(page.getByText('Pair this device')).toHaveCount(0)
  // A real app landmark actually rendered, not a blank/error shell.
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
})

test('Remote access section discloses reachability and pairs a device on demand', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByTestId('settings-view')).toBeVisible()

  const section = page.getByTestId('settings-section-remote-access')
  await section.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await expect(page.getByText('Mill is reachable from any device on your network.')).toBeVisible()
  await expect(page.getByText('This Mac always has access.')).toBeVisible()

  await page.getByTestId('pair-a-device').click()
  const code = page.getByTestId('pairing-code')
  await expect(code).toBeVisible()
  await expect(code).toHaveText(/^[A-Z0-9]{8}$/)
})

// docs/goals/0132-remote-access.md SLICE A: the "Notify me on this
// device" opt-in control. The worker server is a real mill-server
// binary (Server build tag), so the control renders here the same as
// it would over a real Tailscale connection; only the browser's own
// Notification permission is a per-test variable. Confirmed live: this
// harness's headless Chromium reports `Notification.permission` as
// 'denied' unconditionally -- neither leaving it unset nor calling
// `context.grantPermissions(['notifications'])` produces 'default' or
// 'granted' (no notification-display surface exists headless for a
// grant to attach to). Every state below is therefore reached via an
// `addInitScript` stub of `Notification.permission`/`requestPermission`
// (testing.md's documented escape hatch for a state no user primitive
// can reach in this harness), never `dispatchEvent` or a DOM mutation
// on the app's own elements.
test.describe('browser notification opt-in control', () => {
  test('default permission shows the enable button and its caption, never granted/denied text', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window.Notification, 'permission', { value: 'default', configurable: true })
    })
    await page.goto('/')
    await page.getByRole('link', { name: 'Settings' }).click()
    const control = page.getByTestId('browser-notify-control')
    await control.scrollIntoViewIfNeeded()
    await expect(page.getByTestId('browser-notify-enable')).toBeVisible()
    await expect(control).toContainText("this tab isn't in view")
    await expect(page.getByTestId('browser-notify-granted')).toHaveCount(0)
    await expect(page.getByTestId('browser-notify-denied')).toHaveCount(0)
  })

  test('a granted permission renders the granted state with no button', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window.Notification, 'permission', { value: 'granted', configurable: true })
    })
    await page.goto('/')
    await page.getByRole('link', { name: 'Settings' }).click()
    const control = page.getByTestId('browser-notify-control')
    await control.scrollIntoViewIfNeeded()
    await expect(page.getByTestId('browser-notify-granted')).toBeVisible()
    await expect(page.getByTestId('browser-notify-enable')).toHaveCount(0)
  })

  test('a denied permission states it plainly and offers no retry button', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window.Notification, 'permission', { value: 'denied', configurable: true })
    })
    await page.goto('/')
    await page.getByRole('link', { name: 'Settings' }).click()
    const control = page.getByTestId('browser-notify-control')
    await control.scrollIntoViewIfNeeded()
    await expect(page.getByTestId('browser-notify-denied')).toBeVisible()
    await expect(page.getByTestId('browser-notify-denied')).toContainText('browser')
    await expect(page.getByTestId('browser-notify-enable')).toHaveCount(0)
  })

  test('clicking enable calls requestPermission and its result flips the control to granted', async ({ page }) => {
    // No headless UI exists to click Allow on the real permission
    // prompt requestPermission() would otherwise show, so the prompt
    // itself is stubbed to resolve 'granted' -- the click and the
    // resulting UI transition are both real, only the browser-native
    // prompt in between is faked.
    await page.addInitScript(() => {
      Object.defineProperty(window.Notification, 'permission', { value: 'default', configurable: true })
      window.Notification.requestPermission = () => Promise.resolve('granted')
    })
    await page.goto('/')
    await page.getByRole('link', { name: 'Settings' }).click()
    const control = page.getByTestId('browser-notify-control')
    await control.scrollIntoViewIfNeeded()
    await page.getByTestId('browser-notify-enable').click()
    await expect(page.getByTestId('browser-notify-granted')).toBeVisible()
    await expect(page.getByTestId('browser-notify-enable')).toHaveCount(0)
  })
})

// This spec's assertions read the GLOBAL paired-devices list
// (testing.md's shared-pool-vs-dedicated triage), so each test below
// seeds its own uniquely-labeled device and revokes it before
// finishing -- never depending on, or leaving behind, state another
// test in this file could observe.
test('renaming a paired device updates its row and survives a reload', async ({ page }) => {
  // Locate the row by its stable data-device-id, never by its
  // (about to change) label text -- a text-based filter would stop
  // matching the instant the label swaps to the rename input.
  const device = await seedTestDevice(page, 'Old Phone Name')

  await page.goto('/')
  await page.getByRole('link', { name: 'Settings' }).click()
  const row = page.locator(`[data-testid="paired-device-row"][data-device-id="${device.id}"]`)
  await row.scrollIntoViewIfNeeded()
  await expect(row).toContainText('Old Phone Name')

  await row.getByTestId('device-rename-start').click()
  await row.getByTestId('device-rename-input').fill('Ali\'s iPhone')
  await row.getByTestId('device-rename-input').press('Enter')

  await expect(row).toContainText('Ali\'s iPhone')
  await expect(row).not.toContainText('Old Phone Name')

  await page.reload()
  await page.getByRole('link', { name: 'Settings' }).click()
  const rowAfterReload = page.locator(`[data-testid="paired-device-row"][data-device-id="${device.id}"]`)
  await expect(rowAfterReload).toContainText('Ali\'s iPhone')

  await rowAfterReload.getByTestId('revoke-device').click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke' }).click()
  await expect(page.locator(`[data-device-id="${device.id}"]`)).toHaveCount(0)
})

test('a paired device row shows when it was paired and when it was last seen', async ({ page }) => {
  const device = await seedTestDevice(page, 'Freshly Paired Device')

  await page.goto('/')
  await page.getByRole('link', { name: 'Settings' }).click()
  const row = page.locator(`[data-testid="paired-device-row"][data-device-id="${device.id}"]`)
  await row.scrollIntoViewIfNeeded()

  // Paired and last-seen were both stamped "now" by SeedTestDevice --
  // the shared relative-time formatter (shared/inventorySort.ts)
  // renders anything that fresh as "just now".
  await expect(row).toContainText('Paired just now')
  await expect(row).toContainText('last seen just now')

  await row.getByTestId('revoke-device').click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke' }).click()
  await expect(page.getByText('Freshly Paired Device')).toHaveCount(0)
})
