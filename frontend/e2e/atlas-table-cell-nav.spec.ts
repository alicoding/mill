import { test, expect } from './fixtures/server'
import { deleteListNamed, deleteTableViaMenu, openAtlas, placeSizedTable, tableAuditShot } from './fixtures/atlasTable'
import { clickGlideCell, editGlideCell, glideCellText, glideTextEditor } from './fixtures/glideGrid'

async function commitEditor(page: import('@playwright/test').Page, text: string): Promise<void> {
  const editor = glideTextEditor(page).first()
  await expect(editor).toBeVisible()
  await editor.fill(text)
}

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

  // (0,0), explicitly selected -- editGlideCell's own Enter-commit
  // already moves DOWN a row (this test's own next assertion proves
  // that convention), so every cell here is addressed by coordinate,
  // never assumed from a prior step's leftover selection.
  await clickGlideCell(page, glide, 0, 0)
  await page.keyboard.press('Enter')
  await commitEditor(page, 'A')
  await page.keyboard.press('Tab')
  await expect(glideCellText(glide, 0, 0)).toHaveText('A')
  await expect(glideTextEditor(page)).toHaveCount(0)
  await tableAuditShot(page, '09-tab-committed')

  // Tab left the selection one column right, at (0,1) -- Enter there
  // opens ITS editor with no extra click, proving Tab moved it.
  await page.keyboard.press('Enter')
  await commitEditor(page, 'B')
  await page.keyboard.press('Enter')
  await expect(glideCellText(glide, 0, 1)).toHaveText('B')
  await tableAuditShot(page, '09-enter-committed')

  // Enter's own commit-and-move-DOWN landed the selection at (1,1) --
  // Enter there opens IT, proving the down-move.
  await page.keyboard.press('Enter')
  await commitEditor(page, 'C')
  await page.keyboard.press('Enter')
  await expect(glideCellText(glide, 1, 1)).toHaveText('C')

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
