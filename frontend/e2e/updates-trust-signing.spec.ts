import { test, expect } from './fixtures/server'

// Trust Mill's signing certificate (goal 0220 S3, hidden-once-trusted
// refinement). Shared worker pool, not a dedicated server (testing.md)
// -- this spec's only assertion is scoped to the section's own
// visibility, which depends on nothing another test could leave
// behind.
//
// Contract change from goal 0220 S3's original spec: the "How updates
// stay trusted" section now hides itself entirely on a platform with
// no signing concept (SettingsService.IsSigningTrusted's
// ErrUnsupportedPlatform, TrustDisclosure.tsx's mount-time refresh) --
// server-mode's own `codesigning_other.go` stub always takes that
// path, so the section is structurally absent here rather than
// rendering a dead button. The prior version of this spec asserted the
// section visible and drove a click through it; that assertion is now
// the wrong contract for server mode, so it is replaced rather than
// kept alongside the new one. The real trust write (and the button
// that triggers it, and the section hiding once that write succeeds)
// stays desktop-only and manual-only -- see testing.md's manual-only
// registry -- and the visibility STATE MACHINE itself (trusted/
// not-trusted/error branches this platform can't reach) is proven by
// shared/updateNoticeStore.test.ts instead.
test("Settings hides the 'How updates stay trusted' section on a platform with no signing concept", async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByTestId('settings-view')).toBeVisible()

  await expect(page.getByTestId('trust-disclosure')).toHaveCount(0)
})
