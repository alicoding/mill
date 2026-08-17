import { test, expect } from './fixtures/server'
import { groupCard, noteCard } from './fixtures/atlasCards'

// The gesture model (goal 0074) + surface-scoped shortcuts (goal 0071
// slice): click glances, double-click commits, cmd-click opens,
// cmd-ArrowUp climbs the depth ladder -- split from atlas.spec.ts at
// the 500-line convention, same seam the share/projection groups
// already took.

test('the gesture model: double-click commits -- a leaf opens its page, a frame body and a region chip zoom in, chips flip on single click', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  // Leaf double-click = open its page; the commit unflips, so the
  // card is front-facing again once the page closes.
  const getting = noteCard(page, 'Getting started')
  await getting.dblclick()
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-title')).toHaveValue('Getting started')
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()
  await expect(getting).toHaveAttribute('data-flipped', 'false')

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

  // ⌘-click = the pointer twin of ⌘↵: opens the card's page with no
  // flip step, and the card is front-facing behind it.
  await getting.click({ modifiers: ['Meta'] })
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-title')).toHaveValue('Getting started')
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()
  await expect(getting).toHaveAttribute('data-flipped', 'false')
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

