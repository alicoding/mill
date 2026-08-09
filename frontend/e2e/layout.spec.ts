import { test, expect } from '@playwright/test'

// Regression coverage for a real reported layout bug (docs/SPEC.md's
// "Window/scroll layout foundation" Update): .app-shell's own outer
// padding used to wrap the *entire* PageLayout, pushing the sidebar in
// from the window edge, and .page's old 1400px cap left a visibly
// wasted gutter on any normal-or-wider window. Both are checkable
// computed-geometry facts, not screenshot diffs -- per
// .claude/rules/testing.md, a bug confirmed via manual/live
// reproduction (this one was confirmed from real screenshots) becomes a
// committed test, not just a fix trusted to stay fixed.

test.use({ viewport: { width: 1800, height: 900 } })

test('the sidebar sits flush against the window left edge, not inset by outer page padding', async ({ page }) => {
  await page.goto('/')
  const sidebarHeader = page.getByTestId('sidebar-header')
  await expect(sidebarHeader).toBeVisible()
  const box = await sidebarHeader.boundingBox()
  expect(box).not.toBeNull()
  // Primer's own `padding="condensed"` on PageLayout.Sidebar accounts
  // for a small remaining inset; the old bug put a ~68px golden-ratio
  // gap here on top of that.
  expect(box!.x).toBeLessThan(20)
})

test('a wide-variant list page (Workflows) is not capped to the old 1400px width on a wide window', async ({ page }) => {
  await page.goto('/')
  const container = page.getByTestId('composition-view')
  await expect(container).toBeVisible()
  const box = await container.boundingBox()
  expect(box).not.toBeNull()
  // Viewport is 1800px minus a ~256px sidebar -- comfortably over the
  // old 1400px cap this asserts is gone.
  expect(box!.width).toBeGreaterThan(1400)
})

test('a narrow-variant form page (Settings) still keeps its readable width cap', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()
  const container = page.getByTestId('settings-view')
  await expect(container).toBeVisible()
  const box = await container.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeLessThanOrEqual(960)
})
