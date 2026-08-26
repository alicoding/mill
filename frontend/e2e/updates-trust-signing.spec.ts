import { test, expect } from './fixtures/server'

// Trust Mill's signing certificate (goal 0220 S3): the button that
// replaces the former "find it in Keychain Access" hunt. Shared
// worker pool, not a dedicated server (testing.md) -- this test's
// assertions are scoped entirely to its own click, and
// TrustSigningIdentity's server-mode path is a stateless,
// deterministic failure (codesigning_other.go's ErrUnsupportedPlatform
// stub -- server-mode builds never carry the real darwin
// implementation) that depends on no state another test could leave
// behind, the same server-mode fail-closed shape secrets.spec.ts
// already proves for Touch ID. The REAL macOS trust write (and its
// authentication dialog) is desktop-only and manual-only -- see
// testing.md's manual-only registry.
test("Settings shows the Trust Mill's signing button, and its server-mode failure surfaces a copyable error", async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByTestId('settings-view')).toBeVisible()

  const disclosure = page.getByTestId('trust-disclosure')
  await disclosure.locator('summary').click()
  await expect(page.getByTestId('resign-setup-notice')).toContainText("Trust Mill's signing certificate once")

  const button = page.getByTestId('trust-signing-button')
  await expect(button).toHaveText("Trust Mill's signing")
  await expect(page.getByTestId('trust-signing-error')).toHaveCount(0)

  await button.click()

  await expect(page.getByTestId('trust-signing-error')).toContainText("Couldn't trust the signing certificate")
  await expect(page.getByTestId('trust-signing-error-copy')).toBeVisible()
  await expect(button).toBeEnabled()
  await expect(button).toHaveText("Trust Mill's signing")
})
