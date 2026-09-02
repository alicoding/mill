import { test, expect } from './fixtures/server'
import { clickBoardPoint } from './fixtures/atlasBoard'
import { contextMenu } from './fixtures/contextMenu'
import { clickRowAction } from './inventoryRow'

// The adopted grid behind the table extension's flag (ADR-0049, goal
// 0287 slice 0): with "New grid (experimental)" on, a table object
// renders the Glide grid -- observable through the library's own
// accessibility DOM (a role=grid with the List's columns) -- and off
// again it renders the hand-rolled grid. Shared pool: the flag is
// restored to its default and the table + its List deleted before
// the test ends.

async function setNewGrid(page: import('@playwright/test').Page, on: boolean) {
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByTestId('extensions-list')).toBeVisible()
  const row = page.locator('[data-testid="extensions-row"][data-extension-id="table"]')
  if (!(await row.getByTestId('extensions-row-expanded').isVisible())) await row.locator('summary').click()
  const box = page.getByTestId('extension-setting-table-newGrid').locator('input[type="checkbox"]')
  if (on) await box.check()
  else await box.uncheck()
  await expect(box).toBeChecked({ checked: on })
}

test('the table extension\'s New grid flag swaps a table object onto the adopted grid, and back', async ({ page }) => {
  await page.goto('/')
  await setNewGrid(page, true)

  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-size-2x2').click()
  await clickBoardPoint(page, { x: 400, y: 500 })
  const tableObject = page.locator('[data-testid="atlas-board-object"][data-object-kind="table"]')
  await expect(tableObject).toBeVisible()
  const glide = tableObject.getByTestId('atlas-projection-glide')
  await expect(glide).toBeVisible()
  await expect(glide).toHaveAttribute('data-columns', '2')
  await expect(glide).toHaveAttribute('data-rows', '2')
  // The library's accessibility DOM (visually hidden by design) names
  // the List's columns.
  await expect(glide.locator('[role="grid"]')).toBeAttached()
  await expect(glide.locator('[role="grid"]')).toContainText('Column 1')
  await expect(tableObject.getByTestId('atlas-projection-table')).toHaveCount(0)

  // Off again: the hand-rolled grid is back on the same object, live.
  await setNewGrid(page, false)
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(tableObject.getByTestId('atlas-projection-table')).toBeVisible()
  await expect(tableObject.getByTestId('atlas-projection-glide')).toHaveCount(0)

  // Cleanup: the object, then its List.
  await tableObject.click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(tableObject).toHaveCount(0)
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('Table', { exact: true }) })
  await clickRowAction(page, listRow, 'Delete')
  await expect(listRow).toHaveCount(0)
})
