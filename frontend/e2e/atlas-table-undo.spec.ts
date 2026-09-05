import { test, expect } from './fixtures/server'
import { createTableFromList, deleteListNamed, deleteTableViaMenu, escapeGridToObject, openAtlas, placeSizedTable, tableAuditShot, tableObjects } from './fixtures/atlasTable'
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
  const object = await createTableFromList(page, 'Country codes', 'US')
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
  await page.keyboard.press('Meta+z')
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

  await page.keyboard.press('Meta+z')
  await expect.poll(async () => (await object.boundingBox())?.x ?? 0).toBeLessThanOrEqual(before.x + 5)
  await tableAuditShot(page, '14-undo-move')

  await deleteTableViaMenu(object)
  await deleteListNamed(page, 'Table')
})

// The documented gap (AtlasTableTitleRow.tsx's own header comment): a
// cell's own content write goes through Configure's List door, never
// the board journal. So a cell edit puts NOTHING of its own on the
// journal: the next ⌘Z reaches past it to the previous board-surface
// entry -- here the table's own create -- and the typed cell comes
// back untouched with the object.
//
// Every step below is a web-first retrying assertion because ⌘Z is a
// round trip (the request, the journal's inverse, the refetch): a
// one-shot read of the object's presence taken right after the
// keystroke still sees the pre-undo board, and branching on it commits
// the rest of the test to a board state the undo invalidates a frame
// later, which then burns the whole test budget waiting on an object
// that is already gone (goal 0273).
test('a cell edit leaves no entry of its own in the undo journal', async ({ page }) => {
  await openAtlas(page)
  const object = await placeSizedTable(page, '2x2')
  const glide = object.getByTestId('atlas-projection-glide')

  await editGlideCell(page, glide, 0, 0, 'Unjournaled')
  await expect(glideCellText(glide, 0, 0)).toHaveText('Unjournaled')
  await tableAuditShot(page, '14-cell-edited')

  // ⌘Z reaches the canvas only once the grid has handed the keyboard
  // back to the object (escapeGridToObject's own contract comment).
  await escapeGridToObject(page, object)
  await page.keyboard.press('Meta+z')

  // The whole object goes: what reverts is the create, never the cell.
  await expect(object).toHaveCount(0)
  await tableAuditShot(page, '14-undo-after-cell-edit')

  await page.keyboard.press('Meta+Shift+z')
  const restored = tableObjects(page).filter({ hasText: 'Column 1' })
  await expect(restored).toHaveCount(1)
  await expect(glideCellText(restored.getByTestId('atlas-projection-glide'), 0, 0)).toHaveText('Unjournaled')
  await tableAuditShot(page, '14-redo-after-cell-edit')

  await deleteTableViaMenu(restored)
  await deleteListNamed(page, 'Table')
})
