import { test, expect } from './fixtures/server'
import { deleteTableViaMenu, openAtlas, placeSizedTable } from './fixtures/atlasTable'
import { pressUndo } from './fixtures/undoJournal'
import { clickRowAction } from './inventoryRow'
import { openConfigureKind } from './fixtures/configureNav'

// The object<->entity lifecycle contract (docs/goals/0392 S1): a
// board table's delete-time toast states the List's own fate, and
// Configure's Lists page surfaces usage/orphans off the same reference
// index. Shared pool -- both tests create and delete everything they
// touch, never depending on another spec's or the seeded example's own
// state.

function listRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText(label, { exact: true }) })
}

test('deleting a freshly placed table: the toast names the list as unused, and undo restores both the table and its usage', async ({ page }) => {
  await openAtlas(page)
  const object = await placeSizedTable(page, '2x2')
  const title = await object.getByTestId('atlas-table-title').textContent()
  if (!title) throw new Error('table has no title')

  await deleteTableViaMenu(object)
  await expect(page.getByTestId('atlas-undo-toast')).toContainText('Table removed from the board. The list is now unused in Configure.')

  await pressUndo(page)
  const restored = page.locator('[data-testid="atlas-board-object"][data-object-kind="table"]').filter({ hasText: title })
  await expect(restored).toHaveCount(1)

  // Undo re-adds the same live board reference the reference index
  // reads (no separate restore step) -- Configure's own usage line
  // reports the list as used again, off the identical index.
  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'Lists')
  const row = listRow(page, title)
  await expect(row).toContainText('Used on 1 board')

  // Clean up: delete the table again (this time for good) and the List
  // it minted, so nothing outlives this test on the shared server.
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
  const stillThere = page.locator('[data-testid="atlas-board-object"][data-object-kind="table"]').filter({ hasText: title })
  await deleteTableViaMenu(stillThere)
  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'Lists')
  await clickRowAction(page, listRow(page, title), 'Delete')
  await expect(listRow(page, title)).toHaveCount(0)
})

test('Configure Lists: the Unused filter finds a list nothing references, and bulk delete removes it', async ({ page }) => {
  const label = `E2E unused list ${Date.now()}`
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'Lists')

  await page.getByTestId('new-list').click()
  await page.getByLabel('Label').fill(label)
  await page.getByRole('button', { name: 'Save list' }).click()
  await expect(page.getByTestId('list-rows-editor')).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()

  const row = listRow(page, label)
  await expect(row).toContainText('Not used anywhere')

  await page.getByTestId('list-usage-filter').selectOption('unused')
  await expect(row).toBeVisible()
  await row.getByTestId('unused-list-select').check()
  await page.getByTestId('delete-unused-lists').click()
  await expect(row).toHaveCount(0)
})
