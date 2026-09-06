import { test, expect } from './fixtures/server'
import { placeSizedTable } from './fixtures/atlasTable'
import { contextMenu } from './fixtures/contextMenu'
import { clickRowAction } from './inventoryRow'
import { clickGlideCell, dragGlideFillHandle, dragGlideRange, editGlideCell, glideCellText } from './fixtures/glideGrid'
import { openConfigureKind } from './fixtures/configureNav'

// The adopted grid behind the table extension's flag (ADR-0049, goal
// 0287 slice 0): with "New grid (experimental)" on, a table object
// renders the Glide grid -- observable through the library's own
// accessibility DOM (a role=grid with the List's columns) -- and off
// again it renders the hand-rolled grid. Shared pool: the flag is
// restored to its default and the table + its List deleted before
// the test ends.

// Slice 1 (goal 0287): every interaction below is the adopted grid's
// own -- selection by click, Enter to edit, Enter to commit -- with
// Mill's schema and row menus composed on its header and cell events.
// Each test lands a fresh 2x2 table under the flag and deletes it,
// plus the List it created.
async function landGlideTable(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
  await placeSizedTable(page, '2x2')
  const tableObject = page.locator('[data-testid="atlas-board-object"][data-object-kind="table"]')
  await expect(tableObject).toBeVisible()
  const glide = tableObject.getByTestId('atlas-projection-glide')
  await expect(glide).toBeVisible()
  await expect(glide.locator('[role="grid"]')).toBeAttached()
  return { tableObject, glide }
}

async function cleanupGlideTable(page: import('@playwright/test').Page, tableObject: import('@playwright/test').Locator) {
  // The grid host claims right-click for its own row/column menus --
  // the object's own menu opens off its chrome frame instead.
  await tableObject.getByTestId('atlas-board-object-frame').click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(tableObject).toHaveCount(0)
  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'Lists')
  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('Table', { exact: true }) })
  await clickRowAction(page, listRow, 'Delete')
  await expect(listRow).toHaveCount(0)
}

test('a cell edited on the adopted grid writes the List and survives a reload', async ({ page }) => {
  const { tableObject, glide } = await landGlideTable(page)
  await editGlideCell(page, glide, 0, 0, 'Widget')
  await expect(glideCellText(glide, 0, 0)).toHaveText('Widget')

  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  const reloaded = page.locator('[data-testid="atlas-board-object"][data-object-kind="table"]').getByTestId('atlas-projection-glide')
  await expect(reloaded).toBeVisible()
  await expect(glideCellText(reloaded, 0, 0)).toHaveText('Widget')
  await cleanupGlideTable(page, tableObject)
})

test('the header menu renames a column in place, and the row menu inserts a row below', async ({ page }) => {
  const { tableObject, glide } = await landGlideTable(page)
  // Right-click the first header: Mill's column menu at the grid's own rectangle.
  await clickGlideCell(page, glide, -1, 0, { button: 'right' })
  await page.getByTestId('list-grid-column-rename').click()
  const rename = glide.getByTestId('atlas-projection-rename-input')
  await expect(rename).toBeVisible()
  await rename.fill('Vendor') // fill: a form control (goal 0296)
  await rename.press('Enter')
  await expect(glide.locator('[role="grid"]')).toContainText('Vendor')

  await clickGlideCell(page, glide, 0, 0, { button: 'right' })
  await page.getByTestId('atlas-projection-insert-row').click()
  await expect(glide).toHaveAttribute('data-rows', '3')
  await cleanupGlideTable(page, tableObject)
})

test('a column retyped to choices edits through a select and renders a pill', async ({ page }) => {
  const { tableObject, glide } = await landGlideTable(page)
  await clickGlideCell(page, glide, -1, 1, { button: 'right' })
  await page.locator('[data-testid^="list-grid-column-settings-"]').click()
  await page.getByTestId('list-grid-column-type').selectOption('options')
  await page.getByTestId('list-grid-column-options').fill('Open\nDone') // fill: a form control (goal 0296)
  await page.getByTestId('list-grid-column-options').blur()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('list-grid-column-options')).toHaveCount(0)
  // The retype lands through the projection's own refetch.
  await expect(glide).toHaveAttribute('data-col-types', 'text,options')

  await clickGlideCell(page, glide, 0, 1)
  await clickGlideCell(page, glide, 0, 1)
  const select = page.getByTestId('atlas-projection-cell-select')
  await expect(select).toBeVisible()
  await select.selectOption('Done')
  await expect(select).toHaveCount(0)
  await expect(glideCellText(glide, 0, 1)).toHaveText('Done')
  await cleanupGlideTable(page, tableObject)
})

test('arrow keys with a selected cell never move the table object', async ({ page }) => {
  const { tableObject, glide } = await landGlideTable(page)
  await clickGlideCell(page, glide, 0, 0)
  // The node's own transform is the position; its box also grows by
  // the selection outline, which is not a move.
  const position = () => tableObject.evaluate((el) => (el.closest('.react-flow__node') as HTMLElement | null)?.style.transform ?? '')
  const before = await position()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  await expect.poll(position).toBe(before)
  await cleanupGlideTable(page, tableObject)
})

// Goal 0349 S4: the same fill handle and clipboard paste the List grid
// has, on the board's own table object -- both mounts are the one
// shared grid, so both get the library's whole API.
test('the fill handle continues a series on a board table', async ({ page }) => {
  const { tableObject, glide } = await landGlideTable(page)
  await editGlideCell(page, glide, 0, 0, '2')
  await editGlideCell(page, glide, 1, 0, '4')
  // A third row for the series to run into.
  await clickGlideCell(page, glide, 1, 0, { button: 'right' })
  await page.getByTestId('atlas-projection-insert-row').click()
  await expect(glide).toHaveAttribute('data-rows', '3')

  await dragGlideRange(page, glide, { row: 0, col: 0 }, { row: 1, col: 0 })
  await dragGlideFillHandle(page, glide, { row: 1, col: 0 }, { row: 2, col: 0 })
  await expect(glideCellText(glide, 2, 0)).toHaveText('6')
  await cleanupGlideTable(page, tableObject)
})

test('a multi-cell paste applies to a range on a board table', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const { tableObject, glide } = await landGlideTable(page)
  await page.evaluate(() => navigator.clipboard.writeText('Widget\tSmall\nGizmo\tLarge'))
  await clickGlideCell(page, glide, 0, 0)
  await page.keyboard.press('ControlOrMeta+v')
  await expect(glideCellText(glide, 0, 0)).toHaveText('Widget')
  await expect(glideCellText(glide, 0, 1)).toHaveText('Small')
  await expect(glideCellText(glide, 1, 0)).toHaveText('Gizmo')
  await expect(glideCellText(glide, 1, 1)).toHaveText('Large')
  await cleanupGlideTable(page, tableObject)
})

// Regression: a cell's own edit-commit refetches this table's List
// projection on a trailing debounce (AtlasCardProjectionTable.tsx,
// goal 0147); copying the cell before that debounce's window elapses
// must still copy the value just committed, never the pre-edit
// content the projection still held a moment before. A click-copy-
// click-paste run through real keystrokes, with no wait inserted
// between the commit and the copy.
test('copying a cell right after editing it copies the just-committed value, not the pre-edit one', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const { tableObject, glide } = await landGlideTable(page)
  await editGlideCell(page, glide, 0, 0, 'Bolt')
  await clickGlideCell(page, glide, 0, 0)
  await page.keyboard.press('ControlOrMeta+c')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Bolt')
  await clickGlideCell(page, glide, 1, 1)
  await page.keyboard.press('ControlOrMeta+v')
  await expect(glideCellText(glide, 1, 1)).toHaveText('Bolt')

  // The paste itself is a committed edit too -- confirm it, and the
  // original, both survive a reload rather than only painting the canvas.
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  const reloaded = page.locator('[data-testid="atlas-board-object"][data-object-kind="table"]').getByTestId('atlas-projection-glide')
  await expect(reloaded).toBeVisible()
  await expect(glideCellText(reloaded, 0, 0)).toHaveText('Bolt')
  await expect(glideCellText(reloaded, 1, 1)).toHaveText('Bolt')
  await cleanupGlideTable(page, tableObject)
})

// ⌘F reaches the grid on the BOARD mount too, from a cell selected by
// a real click (goal 0349 S4): the click leaves DOM focus inside the
// grid host, which is what scopes the shortcut to this grid. Pinned
// here as well as on the List page because the two mounts differ in
// everything around the grid -- a canvas node with its own keyboard
// path on one, a page on the other.
test('⌘F opens the grid’s own search on a board table', async ({ page }) => {
  const { tableObject, glide } = await landGlideTable(page)
  await clickGlideCell(page, glide, 0, 0)
  await page.keyboard.press('Meta+f')
  const search = glide.getByTestId('search-input')
  await expect(search).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(search).toBeHidden()
  await cleanupGlideTable(page, tableObject)
})
