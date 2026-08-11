import { test, expect } from './fixtures/server'

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
  // sidebar-header (the wordmark + collapse toggle row) moved up into
  // the titlebar band's own left segment (goal: titlebar band tracks
  // the sidebar column) -- sidebar-nav is now the sidebar's first real
  // content, so it's the flush-left assertion's target instead.
  const sidebarNav = page.getByTestId('sidebar-nav')
  await expect(sidebarNav).toBeVisible()
  const box = await sidebarNav.boundingBox()
  expect(box).not.toBeNull()
  // Primer's own `padding="condensed"` on PageLayout.Sidebar accounts
  // for a small remaining inset; the old bug put a ~68px golden-ratio
  // gap here on top of that.
  expect(box!.x).toBeLessThan(20)
})

test('the titlebar band\'s left segment tracks the sidebar column: it resizes and the tab strip shifts when the sidebar collapses', async ({ page }) => {
  // Regression coverage for the reported titlebar-band flaw (docs/SPEC.md
  // §3.8's Update): the band used to ignore the sidebar column entirely
  // -- a fixed traffic-light inset, tabs floating over the whole nav
  // rail, nothing moving when the rail collapsed. The fix makes the
  // band's left segment (.titlebarLeft, data-testid="titlebar-left")
  // track the real sidebar's width via one shared CSS custom property,
  // so the two can never drift apart -- checkable as computed geometry,
  // not a screenshot diff, per .claude/rules/testing.md.
  await page.goto('/')
  const titlebarLeft = page.getByTestId('titlebar-left')
  const toggle = page.getByRole('button', { name: 'Collapse navigation' })
  const firstTab = page.getByRole('tab').first()

  const expandedLeftBox = await titlebarLeft.boundingBox()
  const expandedTabBox = await firstTab.boundingBox()
  expect(expandedLeftBox).not.toBeNull()
  expect(expandedTabBox).not.toBeNull()

  await toggle.click()
  await expect(page.getByRole('button', { name: 'Expand navigation' })).toBeVisible()
  // Let the 0.15s width/flex-basis transition (App.module.css) settle
  // before reading geometry -- same idiom every other transition-
  // sensitive spec in this suite uses.
  await page.waitForTimeout(300)

  const collapsedLeftBox = await titlebarLeft.boundingBox()
  const collapsedTabBox = await firstTab.boundingBox()
  expect(collapsedLeftBox).not.toBeNull()
  expect(collapsedTabBox).not.toBeNull()

  // (a) the band-left segment's width changes when the toggle is clicked.
  expect(collapsedLeftBox!.width).toBeLessThan(expandedLeftBox!.width)
  // The collapsed width matches the sidebar's own collapsed rail width
  // (52px, server mode has no traffic-light inset to widen it).
  expect(Math.abs(collapsedLeftBox!.width - 52)).toBeLessThan(2)

  // (b) the first tab's x position shifts correspondingly -- the tab
  // strip starts right where the left segment ends.
  expect(collapsedTabBox!.x).toBeLessThan(expandedTabBox!.x)
  expect(Math.abs(collapsedTabBox!.x - (collapsedLeftBox!.x + collapsedLeftBox!.width))).toBeLessThan(2)

  // The sidebar column itself shrinks in lockstep -- proof the two
  // elements share the same width, not just two independent animations
  // that happen to both shrink.
  const sidebarNav = page.getByTestId('sidebar-nav')
  const sidebarBox = await sidebarNav.boundingBox()
  expect(sidebarBox).not.toBeNull()
  expect(Math.abs(sidebarBox!.width - collapsedLeftBox!.width)).toBeLessThan(2)

  // (c) the toggle lives inside the band segment, not orphaned below it.
  const toggleBox = await page.getByRole('button', { name: 'Expand navigation' }).boundingBox()
  expect(toggleBox).not.toBeNull()
  expect(toggleBox!.y).toBeGreaterThanOrEqual(collapsedLeftBox!.y)
  expect(toggleBox!.y + toggleBox!.height).toBeLessThanOrEqual(collapsedLeftBox!.y + collapsedLeftBox!.height + 1)

  // Restore the default state so this doesn't leak into other tests via
  // localStorage (each spec gets a fresh browser context in this suite,
  // but keep the toggle symmetric regardless of that).
  await page.getByRole('button', { name: 'Expand navigation' }).click()
  await expect(page.getByRole('button', { name: 'Collapse navigation' })).toBeVisible()
})

test('a wide-variant list page (Workflows) is not capped to the old 1400px width on a wide window', async ({ page }) => {
  await page.goto('/')
  // Home, not Workflows, is the default landing view (docs/goals/0014)
  // -- navigate there explicitly rather than relying on the default.
  await page.getByRole('link', { name: 'Workflows' }).click()
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

test('the editor inner tab bar keeps its natural height, never growing to eat vertical space', async ({ page }) => {
  // Regression coverage for the dead-space bug (owner-reported twice,
  // confirmed by DOM probe): .tabList carried flex-grow for the
  // titlebar strip's ROW context, but WorkflowEditorTab's inner bar
  // sits in .editorPanel's COLUMN, where grow sizes HEIGHT -- the bar
  // ballooned to 178px+ and pushed the panel content far down.
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page
    .locator('[data-testid="inventory-row"][data-entity="workflow"]')
    .filter({ hasText: 'Clipboard → Markdown' })
    .click()
  const innerBar = page.getByRole('tablist', { name: 'Clipboard → Markdown sections' })
  await expect(innerBar).toBeVisible()
  const box = await innerBar.boundingBox()
  if (!box) throw new Error('inner tab bar has no bounding box')
  expect(box.height).toBeLessThan(60)
})
