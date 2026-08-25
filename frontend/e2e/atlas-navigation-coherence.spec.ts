import { test, expect } from './fixtures/server'
import { clickBreadcrumbSegment, groupCard, noteCard } from './fixtures/atlasBoard'

// Goal 0221: a leaf card's own drill door, and the space picker's
// parity with it. Shared worker pool -- every assertion reads the
// seeded default atlas ("The engagement" > "Client records" (group) +
// "Discovery workstream"/"Scratchpad" (leaves), the same fixture every
// other Atlas spec in this pool already reads) and only NAVIGATES
// (viewedID), never creates or mutates data, so nothing needs cleanup.

test('a leaf card shows its own drill door -- entering it lands on its honest empty board', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  // Egocentric-root auto-entry lands inside "The engagement" directly.
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('The engagement')

  await expect(noteCard(page, 'Discovery workstream')).toBeVisible()
  const door = page.locator('[data-testid="atlas-note-drill"][aria-label="Zoom into Discovery workstream"]')
  await expect(door).toBeVisible()

  await door.click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Discovery workstream')
  await expect(page.getByTestId('atlas-empty-space')).toBeVisible()
  await expect(page.getByTestId('atlas-empty-space')).toContainText('Nothing here yet')
  // The commit door is untouched: no card page opened as a side effect
  // of drilling in (goal 0221 item 3 leaves the existing "open the
  // card's own page" action -- cmd-click / a second selected click --
  // exactly as it was).
  await expect(page.locator('[data-component="atlas-card-overlay"]')).not.toBeVisible()
})

test('the space picker never offers an entry the board face hides -- a leaf sibling navigates to the same place its own door does', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await groupCard(page, 'Client records').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Client records')

  // The "Client records" segment's own sibling dropdown -- the space
  // picker the goal's trace names (AtlasBreadcrumbSegment) -- lists
  // "The engagement"'s other children, leaf cards included.
  const segment = page.getByTestId('atlas-breadcrumb').getByText('Client records')
  await clickBreadcrumbSegment(page, segment, 'Discovery workstream')

  // Same destination the board-face door reaches directly (previous
  // test): the leaf's own empty board, breadcrumb selected on it.
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Discovery workstream')
  await expect(page.getByTestId('atlas-empty-space')).toBeVisible()
  await expect(page.locator('[data-component="atlas-card-overlay"]')).not.toBeVisible()
})
