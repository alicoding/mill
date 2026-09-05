import { test, expect } from './fixtures/server'
import type { Page } from '@playwright/test'

// Regression coverage for goal 0216: the Atlas toolbar's action cluster
// used to be a flat, non-shrinking row that silently clipped its own
// trailing buttons off-screen at Mill's real default window size -- no
// e2e asserted in-viewport visibility, only that the buttons existed in
// the DOM. The cluster now splits across two Primer ActionBars (see
// AtlasToolbar.tsx's own header comment for why it's two, not one),
// each shrinking its own row and moving whatever doesn't fit into its
// own "More items" menu.
//
// Scoped to the SHARED worker pool (.claude/rules/testing.md): every
// assertion here reads only the toolbar's own layout/DOM, scoped to
// entities the test itself opens and closes -- no global app state.

const BAR_A_LABEL = 'Arrange, import, export, and folder actions'
const BAR_B_LABEL = 'Share and view actions'

const BAR_A_ACTIONS: { testid: string; label: string }[] = [
  { testid: 'atlas-auto-arrange', label: 'Auto-arrange' },
  { testid: 'atlas-import', label: 'Import' },
  { testid: 'atlas-export', label: 'Export' },
  { testid: 'atlas-add-from-folder', label: 'Add from folder…' },
]
const BAR_B_ACTIONS: { testid: string; label: string }[] = [
  { testid: 'atlas-space-share', label: 'Share' },
  { testid: 'atlas-open-matrix', label: 'Matrix' },
  { testid: 'atlas-open-coverage', label: 'Coverage' },
  { testid: 'atlas-open-roadmap', label: 'Roadmap' },
  { testid: 'atlas-open-kinds', label: 'Kinds' },
  { testid: 'atlas-open-companion', label: 'AI' },
]

// Outside either ActionBar (goal 0216's own reported design conflict):
// the perspective switcher's popover (checkboxes, inline rename, a
// compare dialog launcher) can't be expressed as ActionBar's flat items
// list. It must still never clip.
const PINNED_ACTIONS = ['atlas-perspective-switcher-open']

async function openAtlas(page: Page) {
  await page.goto('/')
  // Below the app shell's own sidebar breakpoint (767px,
  // App.module.css) the nav collapses into a drawer behind a toggle
  // (mobile.spec.ts's own pattern) -- the narrow-width case below runs
  // under that breakpoint. Branch on the test's own known viewport,
  // not a DOM isVisible() probe: page.goto() resolving is a navigation
  // event, not the app mounting (testing.md), and a non-waiting
  // isVisible() check right after goto can race that mount and read
  // the toggle as absent before it renders. mobile-nav-toggle's own
  // .click() below still auto-waits for it, same as mobile.spec.ts.
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
  // expect.poll (testing.md): ActionBar's own overflow detection settles
  // asynchronously after mount, so the first layout pass can still show
  // a not-yet-collapsed row.
  await expect.poll(async () => {
    const box = await page.getByTestId(testid).boundingBox()
    return box ? box.x + box.width : null
  }, `${testid} right edge`).toBeLessThanOrEqual(viewport.width)
  const box = await page.getByTestId(testid).boundingBox()
  if (!box) throw new Error(`${testid} has no bounding box`)
  expect(box.x, `${testid} left edge`).toBeGreaterThanOrEqual(0)
  expect(box.y, `${testid} top edge`).toBeGreaterThanOrEqual(0)
}

// Every ActionBar-managed action is either directly visible in its row
// (and fully on-screen), or reachable through that ActionBar's own
// "More items" menu by its own label -- the exact reachability contract
// goal 0216's acceptance criteria state.
async function assertReachable(page: Page, barLabel: string, action: { testid: string; label: string }) {
  const locator = page.getByTestId(action.testid)
  if (await locator.isVisible()) {
    await assertFullyInViewport(page, action.testid)
    return
  }
  const bar = page.getByRole('toolbar', { name: barLabel })
  const moreButton = bar.getByRole('button', { name: 'More items' })
  await expect(moreButton).toBeVisible()
  await moreButton.click()
  const item = page.getByRole('menuitem', { name: action.label, exact: true })
  await expect(item).toBeVisible()
  await page.keyboard.press('Escape')
}

test.use({ viewport: { width: 1000, height: 618 } })

test('every toolbar action is reachable at Mill\'s real default window size', async ({ page }) => {
  await openAtlas(page)

  for (const testid of PINNED_ACTIONS) {
    await assertFullyInViewport(page, testid)
  }
  for (const action of BAR_A_ACTIONS) {
    await assertReachable(page, BAR_A_LABEL, action)
  }
  for (const action of BAR_B_ACTIONS) {
    await assertReachable(page, BAR_B_LABEL, action)
  }
})

test.describe('narrow width', () => {
  // Mill's own minimum window width (main.go's MinWidth: 640) -- the
  // narrowest this row is ever actually asked to fit, and narrow enough
  // to force both ActionBars into their fully-collapsed overflow state,
  // the actual clipping scenario goal 0216 exists to prevent from EVER
  // happening silently.
  test.use({ viewport: { width: 640, height: 618 } })

  test('clipped actions move into the overflow menu and stay clickable', async ({ page }) => {
    await openAtlas(page)

    for (const testid of PINNED_ACTIONS) {
      await assertFullyInViewport(page, testid)
    }

    // Each ActionBar shows as much as fits and moves only the rest into
    // its own "More items" menu -- never an all-or-nothing collapse --
    // so every action is checked individually via the same reachability
    // contract the default-size test uses, not a blanket "everything's
    // hidden" assumption.
    for (const action of BAR_A_ACTIONS) {
      await assertReachable(page, BAR_A_LABEL, action)
    }
    for (const action of BAR_B_ACTIONS) {
      await assertReachable(page, BAR_B_LABEL, action)
    }

    // At least one action per ActionBar must actually be clipped at
    // this width -- otherwise this test would silently stop exercising
    // the overflow path it exists to cover.
    const barA = page.getByRole('toolbar', { name: BAR_A_LABEL })
    const barB = page.getByRole('toolbar', { name: BAR_B_LABEL })
    await expect(barA.getByRole('button', { name: 'More items' })).toBeVisible()
    await expect(barB.getByRole('button', { name: 'More items' })).toBeVisible()

    // Coverage's real effect (its dialog opening) proves the overflow
    // item is genuinely clickable, not just present in the DOM.
    await expect(page.getByTestId('atlas-open-coverage')).not.toBeVisible()
    await barB.getByRole('button', { name: 'More items' }).click()
    await page.getByRole('menuitem', { name: 'Coverage', exact: true }).click()
    await expect(page.locator('[data-component="atlas-coverage-dialog"]')).toBeVisible()
  })
})
