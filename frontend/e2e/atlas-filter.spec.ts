import { test, expect } from './fixtures/server'

// The board filter bar (goal 0129 slice 1): text + kinds AND
// together, applied as DIM-in-place -- non-matching leaf cards recede
// (data-dimmed) but never disappear, frames stay undimmed, and the
// count line tells the truth. Shared worker pool: reads seeded cards
// only, mutates nothing; clears its own filter state by test end
// (transient state, but tests in this file share a page-load).
test('text and kind filters dim non-matches in place with an honest count', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const dimmed = page.locator('[data-testid="atlas-note-card"][data-dimmed="true"]')
  await expect(dimmed).toHaveCount(0)

  // Collapsed to one icon at rest -- expand it first.
  await page.getByTestId('atlas-filter-toggle').click()

  // Text: only Scratchpad matches; every other leaf dims, none vanish.
  await page.getByTestId('atlas-filter-query').fill('scratchpad')
  await expect(page.locator('[data-testid="atlas-note-card"]').filter({ hasText: 'Scratchpad' }).first()).toHaveAttribute('data-dimmed', 'false')
  await expect(dimmed.first()).toBeVisible()
  await expect(page.getByTestId('atlas-filter-count')).toContainText('1 of')

  // A dimmed card stays clickable-visible (recognition, not removal):
  // Ada Lovelace is still on the board, just receded.
  await expect(page.locator('[data-testid="atlas-note-card"]').filter({ hasText: 'Ada Lovelace' }).first()).toHaveAttribute('data-dimmed', 'true')

  // Kind facet ANDs with text: Scratchpad is a Topic; filtering to
  // Contact dims it too (0 matches, board still visible).
  await page.getByTestId('atlas-filter-kinds').click()
  await page.getByTestId('atlas-filter-kind-atlas-kind-contact').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('atlas-filter-count')).toContainText('0 of')
  await expect(page.getByTestId('atlas-board')).toBeVisible()
  // The active kind renders as a removable chip.
  await expect(page.getByTestId('atlas-filter-chip')).toContainText('Contact')

  // Clear restores the resting board: nothing dimmed, no count line.
  await page.getByTestId('atlas-filter-clear').click()
  await expect(dimmed).toHaveCount(0)
  await expect(page.getByTestId('atlas-filter-count')).toHaveCount(0)
})

// Attribute facets (goal 0129 slice 3): the Fields menu offers the
// options-typed fields of the kinds on the board; picking a value
// dims every card not carrying it. Seed truth this rides on: exactly
// one seeded card ("Getting started", a Topic) has status "Open".
test('a field-value facet dims cards without that value and chips as Field: Value', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await page.getByTestId('atlas-filter-toggle').click()
  await page.getByTestId('atlas-filter-fields').click()
  await page.getByTestId('atlas-filter-field-status-Open').click()
  await page.keyboard.press('Escape')

  await expect(page.getByTestId('atlas-filter-count')).toContainText('1 of')
  await expect(page.locator('[data-testid="atlas-note-card"]').filter({ hasText: 'Getting started' }).first()).toHaveAttribute('data-dimmed', 'false')
  // Scratchpad carries no field values at all -- it never satisfies a
  // field criterion, so it dims.
  await expect(page.locator('[data-testid="atlas-note-card"]').filter({ hasText: 'Scratchpad' }).first()).toHaveAttribute('data-dimmed', 'true')
  await expect(page.getByTestId('atlas-filter-field-chip')).toContainText('Status: Open')

  // Removing the chip restores the resting board (transient state).
  await page.getByTestId('atlas-filter-field-chip').locator('button').click()
  await expect(page.locator('[data-testid="atlas-note-card"][data-dimmed="true"]')).toHaveCount(0)
})
