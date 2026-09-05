import { test, expect } from './fixtures/server'
import type { Locator, Page } from '@playwright/test'
import { deleteListNamed, deleteTableViaMenu, openAtlas, panToEmptyBoard, placeSizedTable, tableAuditShot, tableObjects } from './fixtures/atlasTable'
import { clickBoardPoint } from './fixtures/atlasBoard'

// A table's minted/renamed name is unique among table objects on the
// SAME board (goal 0273 rule 2) -- checked here rather than by
// filtering the shared "Column 1" text every OTHER table object
// carries too, this locates a table by its own title's EXACT text (the
// title row renders nothing else that could collide with it).
function tableObjectByTitle(page: Page, title: string): Locator {
  return tableObjects(page).filter({ has: page.getByTestId('atlas-table-title').getByText(title, { exact: true }) })
}

test('a new table\'s minted name skips every table name already on this board', async ({ page }) => {
  await openAtlas(page)
  await placeSizedTable(page, '2x2')
  const first = tableObjectByTitle(page, 'Table')
  await expect(first).toBeVisible()

  const spot = await panToEmptyBoard(page, { width: 560, height: 220 })
  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-size-2x2').click()
  await clickBoardPoint(page, { x: spot.x + 12, y: spot.y + 12 })

  const second = tableObjectByTitle(page, 'Table 2')
  await expect(second).toBeVisible()
  await tableAuditShot(page, '02-unique-mint-skip')

  await deleteTableViaMenu(second)
  await deleteListNamed(page, 'Table 2')
  await deleteTableViaMenu(first)
  await deleteListNamed(page, 'Table')
})

test('a rename colliding with another table on this board is refused inline, and the previous name stays', async ({ page }) => {
  await openAtlas(page)
  await placeSizedTable(page, '2x2')
  const first = tableObjectByTitle(page, 'Table')
  await expect(first).toBeVisible()

  const spot = await panToEmptyBoard(page, { width: 560, height: 220 })
  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-size-2x2').click()
  await clickBoardPoint(page, { x: spot.x + 12, y: spot.y + 12 })
  const second = tableObjectByTitle(page, 'Table 2')
  await expect(second).toBeVisible()

  const title = second.getByTestId('atlas-table-title')
  await title.dblclick()
  const input = second.getByTestId('atlas-table-title-input')
  await input.fill('Table')
  await page.keyboard.press('Enter')

  const error = second.getByTestId('atlas-table-title-error')
  await expect(error).toHaveText('A table with this name already exists here.')
  // Refused inline: the field stays open and focused, never committed.
  await expect(input).toBeFocused()
  await tableAuditShot(page, '12-rename-collision-refused')

  // Escape now discards the failed draft -- the previous name (never
  // actually overwritten) is what shows.
  await page.keyboard.press('Escape')
  await expect(title).toHaveText('Table 2')

  await deleteTableViaMenu(second)
  await deleteListNamed(page, 'Table 2')
  await deleteTableViaMenu(first)
  await deleteListNamed(page, 'Table')
})
