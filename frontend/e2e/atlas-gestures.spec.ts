import { test, expect } from './fixtures/server'
import { groupCard, noteCard } from './fixtures/atlasCards'
import { clickCorner, zoomAllTheWayOut } from './fixtures/atlasBoard'

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

test('a real double-click reproduces the same select-then-commit outcome as two plain clicks, for both a leaf and a frame body', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const getting = noteCard(page, 'Getting started')
  await getting.dblclick()
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-title')).toHaveValue('Getting started')
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()

  // Frame body double-click = zoom into the place (padding strip:
  // the frame centre belongs to its preview-child nodes).
  const exampleArea = groupCard(page, 'Example area')
  await exampleArea.dblclick({ position: { x: 6, y: 60 } })
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

