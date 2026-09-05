import { test, expect } from './fixtures/server'
import type { Locator, Page } from '@playwright/test'
import { deleteListNamed, deleteTableViaMenu, openAtlas, panToEmptyBoard, placeSizedTable, selectTableObject, tableAuditShot } from './fixtures/atlasTable'
import { clickBoardPoint } from './fixtures/atlasBoard'

// A table's minted/renamed name is unique among table objects on the
// SAME board (goal 0273 rule 2) -- checked here rather than by
// filtering the shared "Column 1" text every OTHER table object
// carries too, this locates a table by its own STABLE data-id (read
// once while its title still shows as text) rather than the title
// text itself: the title's own <Text> unmounts the moment its row
// enters edit -- a locator still filtering on that text would stop
// resolving anything the instant the rename this file drives begins.
async function tableObjectByTitle(page: Page, title: string): Promise<Locator> {
  const wrapper = page.locator('.react-flow__node').filter({ has: page.getByTestId('atlas-table-title').getByText(title, { exact: true }) })
  const id = await wrapper.getAttribute('data-id')
  if (!id) throw new Error(`tableObjectByTitle: no data-id for "${title}"`)
  return page.locator(`.react-flow__node[data-id="${id}"] [data-testid="atlas-board-object"][data-object-kind="table"]`)
}

test('a new table\'s minted name skips every table name already on this board', async ({ page }) => {
  await openAtlas(page)
  await placeSizedTable(page, '2x2')
  const first = await tableObjectByTitle(page, 'Table')
  await expect(first).toBeVisible()

  const spot = await panToEmptyBoard(page, { width: 560, height: 220 })
  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-size-2x2').click()
  await clickBoardPoint(page, { x: spot.x + 12, y: spot.y + 12 })

  const second = await tableObjectByTitle(page, 'Table 2')
  await expect(second).toBeVisible()
  await tableAuditShot(page, '02-unique-mint-skip')

  await deleteTableViaMenu(second)
  await deleteListNamed(page, 'Table 2')
  // Cleanup left Configure showing -- back to Atlas before the next
  // table interaction.
  await openAtlas(page)
  await deleteTableViaMenu(first)
  await deleteListNamed(page, 'Table')
})

test('a rename colliding with another table on this board is refused inline, and the previous name stays', async ({ page }) => {
  await openAtlas(page)
  await placeSizedTable(page, '2x2')
  const first = await tableObjectByTitle(page, 'Table')
  await expect(first).toBeVisible()

  const spot = await panToEmptyBoard(page, { width: 560, height: 220 })
  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-size-2x2').click()
  await clickBoardPoint(page, { x: spot.x + 12, y: spot.y + 12 })
  const second = await tableObjectByTitle(page, 'Table 2')
  await expect(second).toBeVisible()

  // Object first, cell second (goal 0354): a freshly placed object is
  // not the board's selection, so its face is inert until it is.
  await selectTableObject(second)
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
  await openAtlas(page)
  await deleteTableViaMenu(first)
  await deleteListNamed(page, 'Table')
})
