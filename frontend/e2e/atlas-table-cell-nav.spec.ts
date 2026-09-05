import { test, expect } from './fixtures/server'
import { deleteListNamed, deleteTableViaMenu, openAtlas, placeSizedTable, tableAuditShot } from './fixtures/atlasTable'
import { clickGlideCell, editGlideCell, glideCellText, glideTextEditor } from './fixtures/glideGrid'

// The table grid's own keyboard-navigation states in the goal 0273
// state-matrix audit: arrow keys move the selected cell, Tab/Enter
// commit an open editor AND move it (the adopted grid's own
// spreadsheet convention, ListGridGlide.tsx's own header comment --
// never custom-built here), and Delete clears a selected cell's
// content without touching the table object itself. Shared pool --
// every test lands its own table and deletes both the object and the
// List behind it before it ends.

test('arrow keys move the selected cell, never opening an editor', async ({ page }) => {
  await openAtlas(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  const object = await placeSizedTable(page, '2x2')
  const glide = object.getByTestId('atlas-projection-glide')

  await clickGlideCell(page, glide, 0, 0)
  await tableAuditShot(page, '08-arrows-start')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  // Still no editor open -- arrow keys move the SELECTION, not enter it.
  await expect(glideTextEditor(page)).toHaveCount(0)

  // Enter on the now-selected cell (row 1, col 1) opens its editor --
  // the arrows landed where this write actually lands.
  await page.keyboard.press('Enter')
  const editor = glideTextEditor(page).first()
  await expect(editor).toBeVisible()
  await editor.fill('Moved')
  await page.keyboard.press('Enter')
  await expect(glideCellText(glide, 1, 1)).toHaveText('Moved')
  await tableAuditShot(page, '08-arrows-landed')

  await deleteTableViaMenu(object)
  await deleteListNamed(page, 'Table')
})

test('Tab commits and moves right; Enter commits and moves down', async ({ page }) => {
  await openAtlas(page)
  const object = await placeSizedTable(page, '2x2')
  const glide = object.getByTestId('atlas-projection-glide')

  await editGlideCell(page, glide, 0, 0, 'A')
  await expect(glideCellText(glide, 0, 0)).toHaveText('A')
  await tableAuditShot(page, '09-tab-enter-committed-00')

  // Tab from the just-committed cell's own selection opens the NEXT
  // cell to the right -- the adopted grid's own default, never a
  // custom keymap here.
  await page.keyboard.press('Enter')
  await expect(glideTextEditor(page).first()).toBeVisible()
  await glideTextEditor(page).first().fill('B')
  await page.keyboard.press('Tab')
  await expect(glideCellText(glide, 0, 0)).toHaveText('B')
  await expect(glideTextEditor(page)).toHaveCount(0)

  // The selection landed one column right (0,1) -- typing again there
  // and committing with Enter proves it, and moves DOWN a row per the
  // same convention.
  await page.keyboard.press('Enter')
  await expect(glideTextEditor(page).first()).toBeVisible()
  await glideTextEditor(page).first().fill('C')
  await page.keyboard.press('Enter')
  await expect(glideCellText(glide, 0, 1)).toHaveText('C')
  await tableAuditShot(page, '09-tab-enter-committed-01')

  await deleteTableViaMenu(object)
  await deleteListNamed(page, 'Table')
})

test('Delete clears a selected cell\'s content without touching the table object', async ({ page }) => {
  await openAtlas(page)
  const object = await placeSizedTable(page, '2x2')
  const glide = object.getByTestId('atlas-projection-glide')

  await editGlideCell(page, glide, 0, 0, 'Gone soon')
  await expect(glideCellText(glide, 0, 0)).toHaveText('Gone soon')

  // A selecting (not editing) click, then Delete -- the library's own
  // clears-a-selection convention (ListGridGlide.tsx's own header
  // comment), never opening the editor first.
  await clickGlideCell(page, glide, 0, 0)
  await expect(glideTextEditor(page)).toHaveCount(0)
  await page.keyboard.press('Delete')
  await expect(glideCellText(glide, 0, 0)).toHaveText('')
  await tableAuditShot(page, '13-delete-cell-content')
  // The object itself is untouched -- a cell's own content delete never
  // reaches the board's delete-the-object door.
  await expect(object).toHaveCount(1)

  await deleteTableViaMenu(object)
  await deleteListNamed(page, 'Table')
})
