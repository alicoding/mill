import { test, expect } from './fixtures/server'
import type { Page } from '@playwright/test'
import { gotoAppReady } from './fixtures/appReady'
import { openBoardMenu } from './fixtures/toolbarActions'

// The Atlas toolbar's row must never clip its own trailing controls off
// screen at Mill's real window sizes -- the failure goal 0216 exists to
// prevent, restated against the chrome goal 0355 shipped. The row now
// carries only what cannot be folded away: the Board menu (which holds
// every whole-board action), the view switcher (which drops to icons
// when narrow), Share and the companion toggle. So the contract is
// stronger than "reachable via an overflow menu": at 640px, Mill's own
// minimum window width, every one of these is still directly on screen,
// and every board action is one Board-menu click away.
//
// Scoped to the SHARED worker pool (.claude/rules/testing.md): every
// assertion reads only the toolbar's own layout/DOM.

const VIEW_SEGMENTS = ['atlas-open-board', 'atlas-open-contents', 'atlas-open-matrix', 'atlas-open-coverage', 'atlas-open-roadmap']
const ROW_CONTROLS = ['atlas-board-menu', ...VIEW_SEGMENTS, 'atlas-space-share', 'atlas-open-companion']
// Every action that moved into the Board menu, by the testid its own
// menu item declares (shared/atlasBoardCommands.ts).
const BOARD_MENU_ITEMS = ['atlas-auto-arrange', 'atlas-import', 'atlas-add-from-folder', 'atlas-export-json', 'atlas-export-drawio', 'atlas-open-kinds']
// Outside the row's ActionBar: the perspective switcher's popover
// (checkboxes, inline rename, a compare dialog launcher) can't be
// expressed as ActionBar's flat items list. It must still never clip.
const PINNED_ACTIONS = ['atlas-perspective-switcher-open']

async function openAtlas(page: Page) {
  await gotoAppReady(page)
  // Below the app shell's own sidebar breakpoint (767px,
  // App.module.css) the nav collapses into a drawer behind a toggle
  // (mobile.spec.ts's own pattern) -- the narrow-width case below runs
  // under that breakpoint. Branch on the test's own known viewport,
  // not a DOM isVisible() probe: a non-waiting isVisible() check can
  // race the app's mount and read the toggle as absent before it
  // renders. mobile-nav-toggle's own .click() below still auto-waits
  // for it, same as mobile.spec.ts.
  const viewport = page.viewportSize()
  if (viewport && viewport.width < 767) {
    await page.getByTestId('mobile-nav-toggle').click()
  }
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-toolbar')).toBeVisible()
}

async function assertFullyInViewport(page: Page, testid: string) {
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('viewport size unavailable')
  // expect.poll (testing.md): the row settles asynchronously after
  // mount, so the first layout pass can still show a not-yet-shrunk row.
  await expect.poll(async () => {
    const box = await page.getByTestId(testid).boundingBox()
    return box ? box.x + box.width : null
  }, `${testid} right edge`).toBeLessThanOrEqual(viewport.width)
  const box = await page.getByTestId(testid).boundingBox()
  if (!box) throw new Error(`${testid} has no bounding box`)
  expect(box.x, `${testid} left edge`).toBeGreaterThanOrEqual(0)
  expect(box.y, `${testid} top edge`).toBeGreaterThanOrEqual(0)
}

async function assertRowFits(page: Page) {
  for (const testid of [...PINNED_ACTIONS, ...ROW_CONTROLS]) {
    await assertFullyInViewport(page, testid)
  }
}

async function assertBoardMenuHoldsEveryAction(page: Page) {
  await openBoardMenu(page)
  for (const testid of BOARD_MENU_ITEMS) {
    await expect(page.getByTestId(testid), testid).toBeVisible()
  }
  await page.keyboard.press('Escape')
}

test.use({ viewport: { width: 1000, height: 618 } })

test('the whole toolbar row is on screen at Mill\'s real default window size', async ({ page }) => {
  await openAtlas(page)
  await assertRowFits(page)
  await assertBoardMenuHoldsEveryAction(page)
})

test.describe('narrow width', () => {
  // Mill's own minimum window width (main.go's MinWidth: 640) -- the
  // narrowest this row is ever asked to fit, and the width the old
  // two-ActionBar row could only survive by hiding half its actions in
  // two separate overflow menus.
  test.use({ viewport: { width: 640, height: 618 } })

  test('at the minimum window width nothing clips: the switcher drops to icons and Share stays put', async ({ page }) => {
    await openAtlas(page)
    await assertRowFits(page)

    // The switcher is icon-only here (Primer's own hideLabels variant)
    // -- each segment keeps its accessible name, so it is still
    // identifiable without the visible text.
    await expect(page.getByTestId('atlas-view-switcher')).toHaveAttribute('data-variant-narrow', 'hideLabels')
    for (const testid of VIEW_SEGMENTS) {
      await expect(page.getByTestId(testid)).toHaveAttribute('aria-label', /.+/)
    }

    // Share and the companion toggle are the row's only ActionBar
    // members, and two items never overflow -- neither is ever hidden
    // behind a "More items" menu at this width.
    await expect(page.getByTestId('atlas-space-share')).toBeVisible()
    await expect(page.getByTestId('atlas-open-companion')).toBeVisible()

    await assertBoardMenuHoldsEveryAction(page)

    // The menu's real effect, not just its presence: Kinds opens its
    // own dialog from here.
    await openBoardMenu(page)
    await page.getByTestId('atlas-open-kinds').click()
    await expect(page.locator('[data-component="atlas-kind-manager"]')).toBeVisible()
  })
})
