import { test, expect } from './fixtures/server'
import { createTableFromList, deleteListNamed, deleteTableViaMenu, openAtlas, placeSizedTable, tableAuditShot, tableObjects } from './fixtures/atlasTable'
import { dragBetween, dragResizeHandle } from './fixtures/atlasBoard'
import { editGlideCell, glideCellText } from './fixtures/glideGrid'
import { contextMenu } from './fixtures/contextMenu'

// The actor-scoped undo journal's own table coverage (goal 0273's
// state-matrix audit, ADR-0044): every table BOARD-SURFACE mutation
// door (create/delete/size/move) undoes through the SAME ⌘Z/⇧⌘Z
// journal atlas-undo-journal.spec.ts already proves for cards/ink. A
// table's CELL edit and its title RENAME are deliberately OUT of this
// journal (ADR-0044 v1 scope names only board-surface doors; a cell
// edit/rename write through Configure's own List door instead,
// AtlasTableTitleRow.tsx's own header comment) -- the last test below
// pins that as an observable property, not an oversight.

test('creating a table from a List: (Meta+z) removes the object, (Meta+Shift+z) restores it', async ({ page }) => {
  await openAtlas(page)
  const object = await createTableFromList(page, 'Example: Country codes', 'US')
  await expect(object).toHaveCount(1)
  await tableAuditShot(page, '01-create-from-list')

  await page.keyboard.press('Meta+z')
  await expect(tableObjects(page).filter({ hasText: 'US' })).toHaveCount(0)
  await tableAuditShot(page, '14-undo-create')

  await page.keyboard.press('Meta+Shift+z')
  const restored = tableObjects(page).filter({ hasText: 'US' })
  await expect(restored).toHaveCount(1)
  await tableAuditShot(page, '14-redo-create')

  await restored.getByTestId('atlas-board-object-frame').click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(restored).toHaveCount(0)
})

test('deleting a table object: (Meta+z) restores it', async ({ page }) => {
  await openAtlas(page)
  const object = await placeSizedTable(page, '2x2')

  await deleteTableViaMenu(object)
  await tableAuditShot(page, '14-deleted')

  await page.keyboard.press('Meta+z')
  const restored = tableObjects(page).filter({ hasText: 'Column 1' })
  await expect(restored).toHaveCount(1)
  await tableAuditShot(page, '14-undo-delete')

  await deleteTableViaMenu(restored)
  await deleteListNamed(page, 'Table')
})

test('resizing a table object: (Meta+z) reverts its size', async ({ page }) => {
  // Same CI-invisible drag synthesis atlas-table-object.spec.ts's own
  // resize test already documents (QUARANTINE.md atlas-table-resize).
  test.skip(!!process.env.CI, 'drag synthesis coalesces on CI -- QUARANTINE.md atlas-table-resize')
  await openAtlas(page)
  const object = await placeSizedTable(page, '2x2')
  const before = await object.boundingBox()
  if (!before) throw new Error('no table object box')

  await object.getByTestId('atlas-board-object-frame').click()
  const handle = page.locator('.react-flow__resize-control.handle.top.right')
  await expect(handle).toBeVisible()
  await dragResizeHandle(page, handle, 120, -60)
  await expect.poll(async () => (await object.boundingBox())?.width ?? 0).toBeGreaterThan(before.width + 80)
  await tableAuditShot(page, '11-resized')

  await page.keyboard.press('Meta+z')
  await expect.poll(async () => (await object.boundingBox())?.width ?? 0).toBeLessThanOrEqual(before.width + 5)
  await tableAuditShot(page, '14-undo-resize')

  await deleteTableViaMenu(object)
  await deleteListNamed(page, 'Table')
})

test('dragging a table object: (Meta+z) returns it to where it started', async ({ page }) => {
  await openAtlas(page)
  const object = await placeSizedTable(page, '2x2')
  const before = await object.boundingBox()
  if (!before) throw new Error('no table object box')

  const frame = object.getByTestId('atlas-board-object-frame')
  const frameBox = await frame.boundingBox()
  if (!frameBox) throw new Error('no frame box')
  const start = { x: frameBox.x + frameBox.width / 2, y: frameBox.y + frameBox.height / 2 }
  await dragBetween(page, { locator: frame, position: { x: frameBox.width / 2, y: frameBox.height / 2 } }, { x: start.x + 140, y: start.y + 100 })
  await expect.poll(async () => (await object.boundingBox())?.x ?? 0).toBeGreaterThan(before.x + 100)
  await tableAuditShot(page, '14-moved')

  await page.keyboard.press('Meta+z')
  await expect.poll(async () => (await object.boundingBox())?.x ?? 0).toBeLessThanOrEqual(before.x + 5)
  await tableAuditShot(page, '14-undo-move')

  await deleteTableViaMenu(object)
  await deleteListNamed(page, 'Table')
})

// The documented gap (AtlasTableTitleRow.tsx's own header comment): a
// cell's own content write goes through Configure's List door, never
// the board journal -- ⌘Z right after one has nothing OF ITS OWN to
// undo, so it falls through to the table's own CREATE entry instead.
test('a cell edit leaves no entry of its own in the undo journal', async ({ page }) => {
  await openAtlas(page)
  const object = await placeSizedTable(page, '2x2')
  const glide = object.getByTestId('atlas-projection-glide')

  await editGlideCell(page, glide, 0, 0, 'Unjournaled')
  await expect(glideCellText(glide, 0, 0)).toHaveText('Unjournaled')

  // One ⌘Z undoes the table's own CREATE (the only journaled entry so
  // far), not the cell edit -- proof the edit added nothing to pop.
  await page.keyboard.press('Meta+z')
  await expect(object).toHaveCount(0)

  await page.keyboard.press('Meta+Shift+z')
  await expect(tableObjects(page).filter({ hasText: 'Column 1' })).toHaveCount(1)
  const restored = tableObjects(page).filter({ hasText: 'Column 1' })
  await deleteTableViaMenu(restored)
  await deleteListNamed(page, 'Table')
})
