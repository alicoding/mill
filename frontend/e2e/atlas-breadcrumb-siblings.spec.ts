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

  await groupCard(page, 'Client records').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Client records')

  // "The engagement" is the seeded space's own root -- its siblings are
  // every other root-level card, which at the single-root default is
  // only itself. The child count is asserted as a pattern, not an
  // exact number: seeds evolve (goal 0095 added a whole seeded area)
  // and this test pins the dropdown's SHAPE, not the seed catalogue.
  const mySpaceCrumb = page.getByTestId('atlas-breadcrumb').getByTestId('atlas-breadcrumb-item').filter({ hasText: 'The engagement' })
  await mySpaceCrumb.click()

  const dropdown = page.getByTestId('atlas-breadcrumb-siblings')
  await expect(dropdown).toBeVisible()
  const mySpaceRow = dropdown.getByTestId('atlas-breadcrumb-sibling').filter({ hasText: 'The engagement' })
  await expect(mySpaceRow).toBeVisible()
  await expect(mySpaceRow).toContainText(/\d+ cards/)

  // Clicking the current place navigates to it (reproducing the old
  // direct-navigate behavior) -- the crumb collapses back to
  // "The engagement" alone.
  await mySpaceRow.click()
  await expect(dropdown).toHaveCount(0)
  await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('Client records')
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('The engagement')
})

test('clicking a DIFFERENT sibling in the dropdown navigates laterally', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await groupCard(page, 'Client records').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Client records')

  // "Client records"'s own siblings are the OTHER top-level children of
  // "The engagement" -- Discovery workstream, Scratchpad -- neither of which is a
  // place with its own children, so clicking one lands on an empty
  // board (its own drilled-into space), not "Client records"'s own
  // contents.
  const exampleAreaCrumb = page.getByTestId('atlas-breadcrumb').getByTestId('atlas-breadcrumb-item').filter({ hasText: 'Client records' })
  await exampleAreaCrumb.click()
  const dropdown = page.getByTestId('atlas-breadcrumb-siblings')
  await expect(dropdown).toBeVisible()

  const gettingRow = dropdown.getByTestId('atlas-breadcrumb-sibling').filter({ hasText: 'Discovery workstream' })
  await expect(gettingRow).toBeVisible()
  await expect(gettingRow).toContainText('0 cards')
  await gettingRow.click()

  await expect(dropdown).toHaveCount(0)
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('The engagement')
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Discovery workstream')
  await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('Client records')
})
