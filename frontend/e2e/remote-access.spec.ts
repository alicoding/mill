import { test, expect } from './fixtures/server'

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
