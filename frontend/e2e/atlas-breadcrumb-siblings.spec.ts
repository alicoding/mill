import { test, expect } from './fixtures/server'
import { groupCard } from './fixtures/atlasCards'

// The breadcrumb's own sibling dropdown (goal 0106 slice B contract
// item 5): each real segment is a dropdown trigger listing its own
// level's sibling places (name + card count), current one selected --
// clicking any entry (including the current one) navigates, the same
// capability the crumb's old direct-navigate-on-click carried.

test('a breadcrumb segment opens a dropdown of its level\'s siblings, current one selected, with card counts', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await groupCard(page, 'Example area').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Example area')

  // "My space" is the seeded space's own root -- its siblings are
  // every other root-level card, which at the single-root default is
  // only itself (3 top-level children: Example area, Getting started,
  // Scratchpad).
  const mySpaceCrumb = page.getByTestId('atlas-breadcrumb').getByTestId('atlas-breadcrumb-item').filter({ hasText: 'My space' })
  await mySpaceCrumb.click()

  const dropdown = page.getByTestId('atlas-breadcrumb-siblings')
  await expect(dropdown).toBeVisible()
  const mySpaceRow = dropdown.getByTestId('atlas-breadcrumb-sibling').filter({ hasText: 'My space' })
  await expect(mySpaceRow).toBeVisible()
  await expect(mySpaceRow).toContainText('3 cards')

  // Clicking the current place navigates to it (reproducing the old
  // direct-navigate behavior) -- the crumb collapses back to "My
  // space" alone.
  await mySpaceRow.click()
  await expect(dropdown).toHaveCount(0)
  await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('Example area')
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('My space')
})

test('clicking a DIFFERENT sibling in the dropdown navigates laterally', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await groupCard(page, 'Example area').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Example area')

  // "Example area"'s own siblings are the OTHER top-level children of
  // "My space" -- Getting started, Scratchpad -- neither of which is a
  // place with its own children, so clicking one lands on an empty
  // board (its own drilled-into space), not "Example area"'s own
  // contents.
  const exampleAreaCrumb = page.getByTestId('atlas-breadcrumb').getByTestId('atlas-breadcrumb-item').filter({ hasText: 'Example area' })
  await exampleAreaCrumb.click()
  const dropdown = page.getByTestId('atlas-breadcrumb-siblings')
  await expect(dropdown).toBeVisible()

  const gettingRow = dropdown.getByTestId('atlas-breadcrumb-sibling').filter({ hasText: 'Getting started' })
  await expect(gettingRow).toBeVisible()
  await expect(gettingRow).toContainText('0 cards')
  await gettingRow.click()

  await expect(dropdown).toHaveCount(0)
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('My space')
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Getting started')
  await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('Example area')
})
