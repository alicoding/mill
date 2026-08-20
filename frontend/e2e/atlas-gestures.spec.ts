import { test, expect } from './fixtures/server'
import { groupCard, noteCard } from './fixtures/atlasCards'
import { clickCorner, zoomAllTheWayOut, clickFrameGutter } from './fixtures/atlasBoard'
import { contextMenu } from './fixtures/contextMenu'
import { waitForViewportStable } from './fixtures/animation'

// The click model (goal 0102's gesture table) + surface-scoped
// shortcuts (goal 0071 slice): plain click selects/replaces, a second
// click on the already-selected node commits (leaf -> page, place ->
// zoom), double-click reproduces the same outcome as two plain clicks,
// shift-click toggles, cmd-click commits instantly, click-empty
// deselects, cmd-ArrowUp climbs the depth ladder -- split from
// atlas.spec.ts at the 500-line convention, same seam the share/
// projection groups already took.

function selectedWrapper(page: import('@playwright/test').Page, card: import('@playwright/test').Locator) {
  return page.locator('.react-flow__node.selected').filter({ has: card })
}

test('plain click selects (replacing any prior selection); a second click on the already-selected node commits', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const getting = noteCard(page, 'Getting started')
  const scratchpad = noteCard(page, 'Scratchpad')

  await getting.click()
  await expect(selectedWrapper(page, getting)).toHaveCount(1)

  // A DIFFERENT card's plain click replaces the selection outright --
  // never a surface pop, never a co-selection.
  await scratchpad.click()
  await expect(selectedWrapper(page, scratchpad)).toHaveCount(1)
  await expect(selectedWrapper(page, getting)).toHaveCount(0)

  // The already-selected card's own second click commits -- a leaf's
  // commit is its page.
  await scratchpad.click()
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-title')).toHaveValue('Scratchpad')
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()
})

test('a plain click leaves the selection ring visibly showing on the clicked card while it still holds DOM focus, for a note card and a sticky', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  // Regression: Primer's own [role="button"]:focus:not(:focus-visible)
  // reset zeroes any box-shadow scoped to that inner role="button"
  // element -- exactly the state a plain mouse click leaves the
  // clicked card in (focused, but never :focus-visible from a pointer
  // gesture), which made a single-card selection invisible. The ring
  // must show on the wrapper, immune to that reset, while the card is
  // still focused -- not just once focus moves elsewhere.
  const getting = noteCard(page, 'Getting started')
  await getting.click()
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('atlas-note-card')
  const cardWrapper = selectedWrapper(page, getting)
  await expect(cardWrapper).toHaveCount(1)
  await expect.poll(() => cardWrapper.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')

  // A sticky note's own, separately-declared (heavier) ring rule.
  const board = page.getByTestId('atlas-board')
  await zoomAllTheWayOut(page)
  await page.keyboard.press('n')
  await clickCorner(board, 'top-right')
  const noteTA = page.getByTestId('atlas-sticky-textarea')
  await noteTA.fill('ZzE2eStickyRing')
  await noteTA.blur()
  const sticky = page.locator('[data-testid="atlas-sticky-note"]')
  await sticky.click()
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('atlas-sticky-note')
  const stickyWrapper = page.locator('.react-flow__node.selected').filter({ has: sticky })
  await expect(stickyWrapper).toHaveCount(1)
  await expect.poll(() => stickyWrapper.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')

  // Cleanup (testing.md's within-file discipline).
  const menu = contextMenu(page)
  await sticky.click({ button: 'right' })
  await menu.getByText('Delete note', { exact: true }).click()
  await expect(sticky).toHaveCount(0)
})

test('a real double-click reproduces the same select-then-commit outcome as two plain clicks, for both a leaf and a frame body', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  // The board's own initial fitView animates into place, and
  // individual note cards carry their own entrance transition
  // independent of the viewport's own pan/zoom transform -- a
  // dblclick fired before BOTH settle can land on a still-moving
  // neighbor instead of the intended card (regression: "Ada
  // Lovelace"'s node intercepted a dblclick meant for "Getting
  // started" while its own entrance animation was still running).
  await waitForViewportStable(board)
  const getting = noteCard(page, 'Getting started')
  let previousBox: string | null = null
  await expect
    .poll(async () => {
      const box = await getting.boundingBox()
      const current = box ? `${box.x},${box.y}` : null
      const stable = previousBox !== null && current === previousBox
      previousBox = current
      return stable
    })
    .toBe(true)

  await getting.dblclick()
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-title')).toHaveValue('Getting started')
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()

  // Frame body double-click = zoom into the place (padding strip:
  // the frame centre belongs to its preview-child nodes). A FRACTION
  // of the frame's own rendered box (not a fixed pixel offset, same
  // idiom atlas-page.spec.ts's identical gutter click already uses)
  // stays inside the gutter regardless of the board's own zoom scale,
  // which shifts with the seeded card count (goal 0095 slice 3).
  const exampleArea = groupCard(page, 'Example area')
  await clickFrameGutter(exampleArea, { clickCount: 2 })
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Example area')

  // ⌘↑ = one step up the depth ladder (atlas.up, Finder's enclosing-
  // folder convention); at the auto-entered single root it's a no-op.
  await page.keyboard.press('Meta+ArrowUp')
  await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('Example area')
  await page.keyboard.press('Meta+ArrowUp')
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('My space')
})

test('⌘-click commits instantly with no prior selection needed; a plain click on empty canvas deselects', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const getting = noteCard(page, 'Getting started')
  await expect(selectedWrapper(page, getting)).toHaveCount(0)

  // ⌘-click = the pointer twin of ⌘↵: opens the card's page directly,
  // with no prior select-click needed.
  await getting.click({ modifiers: ['Meta'] })
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-title')).toHaveValue('Getting started')
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()

  // Click-empty deselects (React Flow's own native pane-click
  // behavior) -- select the card fresh first.
  await getting.click()
  await expect(selectedWrapper(page, getting)).toHaveCount(1)
  const board = page.getByTestId('atlas-board')
  await zoomAllTheWayOut(page)
  await clickCorner(board, 'top-left')
  await expect(selectedWrapper(page, getting)).toHaveCount(0)
})

test('the Escape ladder: clears a live selection first, then -- with nothing selected -- goes up one level', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await groupCard(page, 'Example area').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Example area')

  const charter = noteCard(page, 'Project charter')
  await charter.click()
  await expect(selectedWrapper(page, charter)).toHaveCount(1)

  // First rung: a live selection exists, so Escape clears it and stays
  // at this level.
  await page.keyboard.press('Escape')
  await expect(selectedWrapper(page, charter)).toHaveCount(0)
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Example area')

  // Second rung: nothing selected, so the SAME key now climbs the
  // depth ladder one step -- the same signal ⌘↑ bumps.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('Example area')
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('My space')
})

test('atlas.up is surface-scoped: listed under "On this page" in the palette on Atlas, absent and inert elsewhere', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await page.keyboard.press('Meta+/')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await expect(palette.getByText('On this page')).toBeVisible()
  await expect(palette.getByText('Go up one level')).toBeVisible()
  await page.keyboard.press('Escape')

  // On Workflows: not listed, and the combo does nothing (no thrown
  // navigation, view stays put).
  await page.getByRole('link', { name: 'Workflows' }).click()
  await expect(page.getByTestId('composition-view')).toBeVisible()
  await page.keyboard.press('Meta+/')
  await expect(palette).toBeVisible()
  await expect(palette.getByText('Go up one level')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+ArrowUp')
  await expect(page.getByTestId('composition-view')).toBeVisible()
})

// The two 0104 residual e2e cases goal 0106 slice B absorbs (useAtlasKeyboardNav.ts's
// key table), plus a verify-only case for arrows-pan-with-no-selection
// (already implemented in slice A -- reported, not built here).

test('Tab cycles focus and selection across top-level cards in reading order', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const exampleArea = groupCard(page, 'Example area')
  const getting = noteCard(page, 'Getting started')

  // Focus lands inside the board wrapper (a click), then Escape's
  // first rung clears the live selection while DOM focus stays on the
  // clicked card -- the same mechanism the Escape-ladder test above
  // already proves -- so the FIRST Tab below starts from "nothing
  // selected", not from this card as an anchor.
  await getting.click()
  await page.keyboard.press('Escape')
  await expect(selectedWrapper(page, getting)).toHaveCount(0)

  // Reading order is left-to-right (atlasKeyboardNavGeometry.ts): the
  // seed's own X positions put Example area (80) before Getting
  // started (532), both on the same row (internal/domain/atlas/
  // builtin.go).
  await page.keyboard.press('Tab')
  await expect(selectedWrapper(page, exampleArea)).toHaveCount(1)

  await page.keyboard.press('Tab')
  await expect(selectedWrapper(page, exampleArea)).toHaveCount(0)
  await expect(selectedWrapper(page, getting)).toHaveCount(1)

  await page.keyboard.press('Shift+Tab')
  await expect(selectedWrapper(page, getting)).toHaveCount(0)
  await expect(selectedWrapper(page, exampleArea)).toHaveCount(1)
})

test('arrow-nudge persists the selected card\'s position', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const getting = noteCard(page, 'Getting started')
  const gettingNode = page.locator('.react-flow__node').filter({ has: getting })
  await getting.click()
  await expect(selectedWrapper(page, getting)).toHaveCount(1)

  // React Flow writes translate(x,y) in flow coords directly onto the
  // node element's own style -- camera-independent, unlike
  // boundingBox() (same technique atlas.spec.ts's own arrange-persists
  // test already established).
  const before = (await gettingNode.evaluate((el) => (el as HTMLElement).style.transform)) ?? ''
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')

  let after = before
  await expect.poll(async () => {
    after = (await gettingNode.evaluate((el) => (el as HTMLElement).style.transform)) ?? ''
    return after
  }).not.toBe(before)

  // The Go-side SetPosition write is batched to keyup, not per-pixel --
  // a reload renders the SAME persisted position, proving the nudge
  // actually round-tripped through the backend, not just the live DOM.
  await page.reload()
  await expect(page.getByTestId('atlas-view')).toBeVisible()
  await expect(gettingNode).toBeVisible()
  await expect.poll(async () => gettingNode.evaluate((el) => (el as HTMLElement).style.transform), { timeout: 10_000 }).toBe(after)

  // Cleanup: nudge back to the seeded position (testing.md's
  // within-file discipline). Press-until-restored, not a fixed count
  // (goal 0134 class 1): the forward presses can be lost on the CI
  // runner, so a mirrored fixed count overshoots or undershoots --
  // re-delivering one press per poll attempt restores the exact
  // seeded transform regardless of how many forward presses landed.
  await getting.click()
  await expect(selectedWrapper(page, getting)).toHaveCount(1)
  await expect.poll(async () => {
    const current = (await gettingNode.evaluate((el) => (el as HTMLElement).style.transform)) ?? ''
    if (current !== before) await page.keyboard.press('ArrowLeft')
    return gettingNode.evaluate((el) => (el as HTMLElement).style.transform)
  }, { timeout: 15_000 }).toBe(before)
})

// Verify-only (goal 0106 slice B's residual audit): arrows with NO
// selection pan the camera instead of nudging -- already implemented
// in slice A (useAtlasKeyboardNav.ts), not new work here.
test('arrows with no selection pan the camera instead of nudging', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  const getting = noteCard(page, 'Getting started')
  await getting.click()
  await page.keyboard.press('Escape')
  await expect(selectedWrapper(page, getting)).toHaveCount(0)

  const viewport = board.locator('.react-flow__viewport')
  const before = await viewport.evaluate((el) => (el as HTMLElement).style.transform)
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => viewport.evaluate((el) => (el as HTMLElement).style.transform)).not.toBe(before)

  // Cleanup: pan back so this test leaves the camera where it found it.
  await page.keyboard.press('ArrowLeft')
})

