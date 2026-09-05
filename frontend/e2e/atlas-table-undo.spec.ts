import { test, expect } from './fixtures/server'
import { createTableFromList, deleteListNamed, deleteTableViaMenu, escapeGridToObject, openAtlas, placeSizedTable, tableAuditShot, tableObjects } from './fixtures/atlasTable'
import { dragBetween, dragResizeHandle } from './fixtures/atlasBoard'
import { editGlideCell, glideCellText } from './fixtures/glideGrid'
import { contextMenu } from './fixtures/contextMenu'
import { pressRedo, pressUndo } from './fixtures/undoJournal'

// The actor-scoped undo journal's own table coverage (goal 0273's
// state-matrix audit, ADR-0044): every table BOARD-SURFACE mutation
// door (create/delete/size/move) undoes through the SAME ⌘Z/⇧⌘Z
// journal atlas-undo-journal.spec.ts already proves for cards/ink --
// and so does a CELL edit, which writes through Configure's List door
// into that same one journal (goal 0352). The last test below is the
// ordering that gap cost: ⌘Z right after typing in a cell restores the
// cell, and the table stays where it is.

test('creating a table from a List: (Meta+z) removes the object, (Meta+Shift+z) restores it', async ({ page }) => {
  await openAtlas(page)
  const object = await createTableFromList(page, 'Country codes', 'US')
  await expect(object).toHaveCount(1)
  await tableAuditShot(page, '01-create-from-list')

  await pressUndo(page)
  await expect(tableObjects(page).filter({ hasText: 'US' })).toHaveCount(0)
  await tableAuditShot(page, '14-undo-create')

  await pressRedo(page)
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

  await pressUndo(page)
  const restored = tableObjects(page).filter({ hasText: 'Column 1' })
  await expect(restored).toHaveCount(1)
  await tableAuditShot(page, '14-undo-delete')

  await deleteTableViaMenu(restored)
  await deleteListNamed(page, 'Table')
})

test('resizing a table object: (Meta+z) reverts its size', async ({ page }) => {
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

  // A first-ever resize's undo restores the natural (pre-resize) size,
  // never a collapsed 0x0 box (the one size-undo helper, goal 0273
  // defect class, #686).
  await pressUndo(page)
  await expect.poll(async () => (await object.boundingBox())?.width ?? 0).toBeGreaterThan(0)
  await expect.poll(async () => (await object.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(before.width - 2)
  await expect.poll(async () => (await object.boundingBox())?.width ?? 0).toBeLessThanOrEqual(before.width + 2)
  await expect.poll(async () => (await object.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(before.height - 2)
  await expect.poll(async () => (await object.boundingBox())?.height ?? 0).toBeLessThanOrEqual(before.height + 2)
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

  await pressUndo(page)
  await expect.poll(async () => (await object.boundingBox())?.x ?? 0).toBeLessThanOrEqual(before.x + 5)
  await tableAuditShot(page, '14-undo-move')

  await deleteTableViaMenu(object)
  await deleteListNamed(page, 'Table')
})

// One journal, in order (goal 0352): the cell edit is the newest step,
// so the first ⌘Z restores the cell and the table -- created BEFORE it
// -- stays put. Before the cell write was journaled, this same ⌘Z
// reached past the edit to the table's own create and deleted it.
test('a cell edit: (Meta+z) restores the cell and leaves the table in place', async ({ page }) => {
  await openAtlas(page)
  const object = await placeSizedTable(page, '2x2')
  const glide = object.getByTestId('atlas-projection-glide')

  await editGlideCell(page, glide, 0, 0, 'Journaled')
  await expect(glideCellText(glide, 0, 0)).toHaveText('Journaled')

  await escapeGridToObject(page, object)
  await pressUndo(page)

  await expect(glideCellText(glide, 0, 0)).toHaveText('')
  await expect(object).toHaveCount(1)
  await tableAuditShot(page, '14-undo-cell-edit')

  await pressRedo(page)
  await expect(glideCellText(glide, 0, 0)).toHaveText('Journaled')
  await expect(object).toHaveCount(1)

  // A second ⌘Z reaches the step under the cell edit -- the table's own
  // create -- which is what one ordered history means.
  await pressUndo(page)
  await expect(glideCellText(glide, 0, 0)).toHaveText('')
  await pressUndo(page)
  await expect(object).toHaveCount(0)

  await deleteListNamed(page, 'Table')
})
