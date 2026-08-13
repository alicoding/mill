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

  // (b) the first tab shifts left by EXACTLY the width the segment
  // lost -- the lockstep invariant. Deliberately not "tab.x == segment
  // right edge": the strip has its own legitimate padding between the
  // divider and the first tab, and pinning that spacing here would turn
  // a cosmetic padding tweak into a test failure.
  expect(collapsedTabBox!.x).toBeLessThan(expandedTabBox!.x)
  const tabShift = expandedTabBox!.x - collapsedTabBox!.x
  const segmentShrink = expandedLeftBox!.width - collapsedLeftBox!.width
  expect(Math.abs(tabShift - segmentShrink)).toBeLessThan(2)

  // The sidebar column itself shrinks in lockstep -- proof the two
  // elements share the same width, not just two independent animations
  // that happen to both shrink.
  const sidebarNav = page.getByTestId('sidebar-nav')
  const sidebarBox = await sidebarNav.boundingBox()
  expect(sidebarBox).not.toBeNull()
  expect(Math.abs(sidebarBox!.width - collapsedLeftBox!.width)).toBeLessThan(2)

  // (c) the toggle lives in the SIDEBAR's own top row, below the band
  // (owner design 2026-08-11: the control sits next to the nav it
  // controls; collapsed, the same slot is the Mill icon that swaps to
  // this expand affordance on hover/focus). Its x stays inside the
  // rail column.
  const toggleBox = await page.getByRole('button', { name: 'Expand navigation' }).boundingBox()
  expect(toggleBox).not.toBeNull()
  expect(toggleBox!.y).toBeGreaterThanOrEqual(collapsedLeftBox!.y + collapsedLeftBox!.height - 1)
  expect(toggleBox!.x + toggleBox!.width).toBeLessThanOrEqual(collapsedLeftBox!.x + collapsedLeftBox!.width + 1)

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
  // Regression coverage for the dead-space bug (live-reproduced twice,
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

test.describe('tab strip vs build badge', () => {
  // Narrow viewport ON PURPOSE: the ⌄ button hugs the END of the tab
  // row, so the old fixed badge only covered it once enough tabs pushed
  // the row's end under the window's top-right corner -- at this file's
  // default 1800px with two short tabs they never meet, and a first cut
  // of this test at that width passed against the BUGGY layout
  // (verified, honestly: the repro must fill the strip, not just open
  // the menu).
  test.use({ viewport: { width: 1000, height: 800 } })

  test('the tab-strip overflow button is clickable with the build badge present, and the badge lives inside the band', async ({ page }) => {
  // Regression coverage for the live-caught overlay bug (2026-08-11):
  // the build-identity badge was position:fixed at the window's
  // top-right, exactly over the tab strip's pinned "All open tabs" ⌄
  // button, and intercepted its clicks -- the same overlay-blocks-chrome
  // class the isolated-data ribbon already hit once with the sidebar
  // toggle. The fix makes the badge a flex participant in the band's
  // own right segment, so overlap is impossible by construction.
  // Asserted as a real hit-test (elementFromPoint), not just
  // visibility, per .claude/rules/testing.md -- visibility was never
  // the problem, hit-interception was.
  await page.goto('/')
  const row = (label: string) =>
    page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ hasText: label })
  // Enough tabs to fill the strip so the ⌄ button lands at the band's
  // right edge -- the geometry the bug needs.
  for (const label of [
    'Clipboard → Markdown',
    'Load sample HTML',
    'Example: Parent → child call',
    'Example: Country code lookup',
    'Example: MCP echo call',
  ]) {
    await page.getByRole('link', { name: 'Workflows' }).click()
    await row(label).click()
  }

  // The badge (SERVER · <hash> under the e2e server build) renders
  // inside the 38px band, not floating over it.
  const badge = page.getByTestId('server-build-badge')
  await expect(badge).toBeVisible()
  const badgeBox = await badge.boundingBox()
  if (!badgeBox) throw new Error('badge has no bounding box')
  expect(badgeBox.y + badgeBox.height).toBeLessThanOrEqual(38)

  // The overflow ⌄ button (shown at 2+ work tabs) is the top hit target
  // at its own center -- the exact property the fixed badge broke.
  const overflow = page.getByTestId('work-tab-overflow')
  await expect(overflow).toBeVisible()
  const box = await overflow.boundingBox()
  if (!box) throw new Error('overflow button has no bounding box')
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="work-tab-overflow"]') != null,
    [box.x + box.width / 2, box.y + box.height / 2],
  )
  expect(hit).toBe(true)

  // And it actually works end-to-end -- which also cleans up this
  // test's own tabs (within-file discipline).
  await overflow.click()
  await expect(page.getByRole('menuitem', { name: 'Close other tabs' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Close all tabs' }).click()
  await expect(page.getByTestId('work-tab-overflow')).toHaveCount(0)
})
})
