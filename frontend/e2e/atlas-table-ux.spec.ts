import { test, expect } from './fixtures/server'
import type { Page } from '@playwright/test'
import { deleteListNamed, deleteTableViaMenu, openAtlas, panToEmptyBoard, placeSizedTable, tableAuditShot, tableObjects } from './fixtures/atlasTable'
import { clickBoardPoint, hoverBoardPoint, nonSeededBoardObjects } from './fixtures/atlasBoard'
import { findEmptyBoardRect } from './fixtures/atlasEmptyRegion'
import { waitForViewportStable } from './fixtures/animation'
import { contextMenu } from './fixtures/contextMenu'
import { clickGlideCell, glideTextEditor, openGlideCellEditor } from './fixtures/glideGrid'

// The converged canvas-table interactions (goal 0273): object first
// then cells, a name above the grid renamed in place, and a placement
// ghost that answers "where will it land" before the click. Shared
// worker pool -- every test lands its own table and deletes both the
// object and the List behind it before it ends.

// The board's own layout constants (atlasBoardLayout.ts), restated here
// because the placement ghost's footprint is what this spec measures.
const TABLE_WIDTH = 520
const TABLE_HEIGHT = 320

// The board's live zoom, read off the canvas kit's own viewport
// transform -- the ghost is drawn in screen pixels, so its expected
// footprint scales with it.
async function boardZoom(page: Page): Promise<number> {
  return page.locator('.react-flow__viewport').evaluate((el) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform)
    return m.a || 1
  })
}

test('hovering an unselected table shows its hover ring and its band names the first click', async ({ page }) => {
  await openAtlas(page)
  const object = await placeSizedTable(page, '2x2')
  await page.keyboard.press('Escape')
  await expect(object.getByTestId('atlas-object-click-shield')).toHaveCount(1)

  await object.hover()
  await expect(object.getByTestId('atlas-board-object-frame')).toHaveAttribute('title', 'Click to select, then click a cell to edit')
  await tableAuditShot(page, '03-hover-unselected')

  await deleteTableViaMenu(object)
  await deleteListNamed(page, 'Table')
})

test('the first click on a table selects the object, and only then do clicks reach its cells', async ({ page }) => {
  await openAtlas(page)
  const object = await placeSizedTable(page, '2x2')
  await tableAuditShot(page, '01-created-selected')

  // Back to unselected, the way a user leaves an object: Escape.
  await page.keyboard.press('Escape')
  await expect(object.getByTestId('atlas-object-click-shield')).toHaveCount(1)

  await object.click()
  await expect(page.locator('.react-flow__node.selected [data-object-kind="table"]')).toHaveCount(1)
  // The click selected the OBJECT -- it did not land in a cell.
  await expect(glideTextEditor(page)).toHaveCount(0)
  await expect(object.getByTestId('atlas-object-click-shield')).toHaveCount(0)
  await tableAuditShot(page, '04-click-selects-object')

  // With the object selected the grid is live: a cell activates.
  const glide = object.getByTestId('atlas-projection-glide')
  await clickGlideCell(page, glide, 0, 0)
  await expect(glideTextEditor(page)).toHaveCount(0)
  await tableAuditShot(page, '05-click-cell-grid-live')
  await openGlideCellEditor(page, glide, 0, 0, glideTextEditor(page).first())
  await tableAuditShot(page, '06-doubleclick-cell-edit')
  await page.keyboard.press('Escape')
  await tableAuditShot(page, '10-escape-editor-to-grid')

  await deleteTableViaMenu(object)
  await deleteListNamed(page, 'Table')
})

test('a table names itself above its grid, and the name is renamed in place', async ({ page }) => {
  await openAtlas(page)
  const object = await placeSizedTable(page, '2x2')
  const title = object.getByTestId('atlas-table-title')
  await expect(title).toHaveText('Table')

  await title.dblclick()
  const input = object.getByTestId('atlas-table-title-input')
  await expect(input).toBeFocused()
  await tableAuditShot(page, '12-rename-dblclick-editing')

  // An empty submit keeps the previous name -- a table always has one.
  await input.fill('')
  await page.keyboard.press('Enter')
  await expect(title).toHaveText('Table')
  await tableAuditShot(page, '12-rename-empty-keeps-name')

  await title.dblclick()
  await input.fill('Budget')
  await page.keyboard.press('Enter')
  await expect(title).toHaveText('Budget')
  await tableAuditShot(page, '12-rename-committed')

  // The List behind it is the single source -- Configure sees the same
  // name.
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  await expect(page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('Budget', { exact: true }) })).toHaveCount(1)

  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  // Located by not being one of the seeded examples, never by its text:
  // once the title is an input its name is a value, not page text.
  const reloaded = nonSeededBoardObjects(page, 'table')
  await expect(reloaded.getByTestId('atlas-table-title')).toHaveText('Budget')

  // Escape leaves the edit with the name untouched.
  await reloaded.getByTestId('atlas-table-title').dblclick()
  const reopened = reloaded.getByTestId('atlas-table-title-input')
  await reopened.fill('Discarded')
  await page.keyboard.press('Escape')
  await expect(reloaded.getByTestId('atlas-table-title')).toHaveText('Budget')

  await deleteTableViaMenu(reloaded)
  await deleteListNamed(page, 'Budget')
})

test('Rename on a table object opens its title for editing', async ({ page }) => {
  await openAtlas(page)
  const object = await placeSizedTable(page, '2x2')

  await object.getByTestId('atlas-board-object-frame').click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await tableAuditShot(page, '12-rename-contextmenu-open')
  await menu.getByText('Rename', { exact: true }).click()

  const input = object.getByTestId('atlas-table-title-input')
  await expect(input).toBeFocused()
  await tableAuditShot(page, '12-rename-contextmenu-editing')
  await page.keyboard.press('Escape')
  await expect(object.getByTestId('atlas-table-title')).toHaveText('Table')

  await deleteTableViaMenu(object)
  await deleteListNamed(page, 'Table')
})

test('a picked table size follows the pointer as a ghost, and lands where the ghost sits', async ({ page }) => {
  await openAtlas(page)
  const board = page.getByTestId('atlas-board')
  const spot = await panToEmptyBoard(page, { width: 560, height: 220 })

  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-size-3x3').click()

  const ghost = page.getByTestId('atlas-table-ghost')
  const target = { x: spot.x + 12, y: spot.y + 12 }
  await hoverBoardPoint(page, target)
  await expect(ghost).toBeVisible()
  const pendingName = (await ghost.innerText()).trim()
  expect(pendingName).toMatch(/^Table( \d+)?$/)
  await tableAuditShot(page, '00-create-ghost')

  const zoom = await boardZoom(page)
  const ghostBox = await ghost.boundingBox()
  if (!ghostBox) throw new Error('no ghost box')
  expect(Math.abs(ghostBox.width - TABLE_WIDTH * zoom)).toBeLessThanOrEqual(2)
  expect(Math.abs(ghostBox.height - TABLE_HEIGHT * zoom)).toBeLessThanOrEqual(2)
  expect(Math.abs(ghostBox.x - target.x)).toBeLessThanOrEqual(2)
  expect(Math.abs(ghostBox.y - target.y)).toBeLessThanOrEqual(2)

  await clickBoardPoint(page, target)
  await expect(ghost).toHaveCount(0)
  const object = tableObjects(page).filter({ hasText: 'Column 1' })
  await expect(object).toBeVisible()
  // The table lands where the ghost stood, and carries the name the
  // ghost showed.
  await expect(object.getByTestId('atlas-table-title')).toHaveText(pendingName)
  const landed = await object.boundingBox()
  if (!landed) throw new Error('no landed box')
  expect(Math.abs(landed.x - target.x)).toBeLessThanOrEqual(4)
  expect(Math.abs(landed.y - target.y)).toBeLessThanOrEqual(4)

  // Escape cancels a pending placement: no ghost, and nothing created.
  const before = await tableObjects(page).count()
  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-size-3x3').click()
  await waitForViewportStable(board)
  const second = await findEmptyBoardRect(page, board, 560, 220)
  await hoverBoardPoint(page, { x: second.x + 12, y: second.y + 12 })
  await expect(ghost).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(ghost).toHaveCount(0)
  await clickBoardPoint(page, { x: second.x + 12, y: second.y + 12 })
  await expect(tableObjects(page)).toHaveCount(before)

  await deleteTableViaMenu(object)
  await deleteListNamed(page, pendingName)
})

test('Escape in the grid hands the keyboard back, so Delete removes the table', async ({ page }) => {
  await openAtlas(page)
  const object = await placeSizedTable(page, '2x2')
  const glide = object.getByTestId('atlas-projection-glide')

  await clickGlideCell(page, glide, 0, 0)
  await page.keyboard.press('Escape')
  await tableAuditShot(page, '10-escape-grid-to-object')
  await page.keyboard.press('Backspace')
  await expect(object).toHaveCount(0)
  await tableAuditShot(page, '13-delete-object')

  await deleteListNamed(page, 'Table')
})
