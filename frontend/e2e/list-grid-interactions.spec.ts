import { test, expect, type Page } from './fixtures/server'
import { callBindingViaRPC } from './fixtures/wailsRpc'
import { pressRedo, pressUndo } from './fixtures/undoJournal'
import { clickGlideCell, clickGlideRowMarker, dragGlideColumnEdge, dragGlideFillHandle, dragGlideRange, editGlideCell, glideCellText, glideTextEditor, typeOverGlideCell } from './fixtures/glideGrid'

// The eight converged table interactions on the List grid (goal 0349
// S4): range select, type-to-overwrite, fill handle, clipboard both
// ways, column resize and reorder, row and column insert/delete,
// header-click sort with a per-column filter, and a multi-row
// selection's bulk actions. Each is the adopted library's own
// behaviour or Mill's composition on it -- these tests pin the
// behaviour a user gets, not the props that produce it.
//
// Shared pool: every test seeds its OWN List over the bound service and
// deletes it at the end, so nothing here depends on state another test
// left behind.

const CONFIGURE = 'github.com/alicoding/mill/internal/services/configuresvc.ConfigureService'

const COLUMNS = [
  { Key: 'name', Label: 'Name', Type: 'text' },
  { Key: 'qty', Label: 'Qty', Type: 'number' },
]

interface SeededList { ID: string }

// A List with two columns and four rows, opened in Configure's grid.
async function seedAndOpen(page: Page, label: string, rows: Record<string, string>[]): Promise<{ id: string; glide: ReturnType<Page['getByTestId']> }> {
  await page.goto('/')
  const list = await callBindingViaRPC<SeededList>(page, `${CONFIGURE}.CreateListWithRows`, [label, '', COLUMNS, rows])
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  const row = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText(label, { exact: true }) })
  await expect(row).toBeVisible()
  // The row itself opens its editor (InventoryList's onOpen).
  await row.click()
  const glide = page.getByTestId('atlas-projection-glide')
  await expect(glide).toBeVisible()
  await expect(glide.locator('[role="grid"]')).toBeAttached()
  return { id: list.ID, glide }
}

// Re-opens the same List's grid after a reload: Configure's editor is
// not URL-addressable, so a reload lands on the app's own default view.
async function reopen(page: Page, label: string) {
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  const row = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText(label, { exact: true }) })
  await expect(row).toBeVisible()
  await row.click()
  const glide = page.getByTestId('atlas-projection-glide')
  await expect(glide).toBeVisible()
  return glide
}

// Escape hands the keyboard back from the grid (ListGridGlide's own
// release path): with no overlay editor open it blurs the grid, so an
// app-level shortcut like ⌘Z reaches the window's own listener.
async function escapeGrid(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName ?? '')).not.toMatch(/INPUT|TEXTAREA/)
}

async function cleanup(page: Page, id: string): Promise<void> {
  await callBindingViaRPC(page, `${CONFIGURE}.DeleteList`, [id])
}

const FOUR_ROWS = [
  { name: 'Bolt', qty: '1' },
  { name: 'Anvil', qty: '3' },
  { name: 'Cog', qty: '' },
  { name: 'Drill', qty: '' },
]

// 1. Range select: a drag makes a rectangle, and the rectangle is the
// unit Delete acts on.
test('a dragged range is the unit Delete clears', async ({ page }) => {
  const { id, glide } = await seedAndOpen(page, 'E2E grid range select', FOUR_ROWS)
  await dragGlideRange(page, glide, { row: 0, col: 0 }, { row: 1, col: 1 })
  await page.keyboard.press('Delete')
  await expect(glideCellText(glide, 0, 0)).toHaveText('')
  await expect(glideCellText(glide, 1, 0)).toHaveText('')
  await expect(glideCellText(glide, 0, 1)).toHaveText('')
  await expect(glideCellText(glide, 1, 1)).toHaveText('')
  // Outside the range, untouched.
  await expect(glideCellText(glide, 2, 0)).toHaveText('Cog')
  await cleanup(page, id)
})

// 2. Typing over a selected cell opens its editor with what was typed;
// Enter commits and moves down, Tab commits and moves right.
test('typing overwrites the selected cell, Enter commits down and Tab commits right', async ({ page }) => {
  const { id, glide } = await seedAndOpen(page, 'E2E grid typing', FOUR_ROWS)
  const editor = glideTextEditor(page).first()
  await typeOverGlideCell(page, glide, 0, 0, 'W', editor)
  await expect(editor).toHaveValue('W')
  await editor.fill('Widget') // fill: a form control (goal 0296)
  await page.keyboard.press('Enter')
  await expect(glideCellText(glide, 0, 0)).toHaveText('Widget')

  // Enter left the selection on the row below: typing there lands in
  // row 1, and Tab commits it.
  await page.keyboard.press('G')
  await expect(editor).toBeVisible()
  await editor.fill('Gadget')
  await page.keyboard.press('Tab')
  await expect(glideCellText(glide, 1, 0)).toHaveText('Gadget')
  await cleanup(page, id)
})

// 3. Fill handle: dragging it from a two-cell numeric source continues
// the series; the fill lands through the same edit door a typed commit
// does, so it survives a reload.
test('the fill handle continues a numeric series down a column', async ({ page }) => {
  const { id, glide } = await seedAndOpen(page, 'E2E grid fill handle', FOUR_ROWS)
  await dragGlideRange(page, glide, { row: 0, col: 1 }, { row: 1, col: 1 })
  await dragGlideFillHandle(page, glide, { row: 1, col: 1 }, { row: 3, col: 1 })
  await expect(glideCellText(glide, 2, 1)).toHaveText('5')
  await expect(glideCellText(glide, 3, 1)).toHaveText('7')

  // The fill went through the same edit door a typed commit does: the
  // stored List, not just the painted cells, carries the series.
  const stored = await callBindingViaRPC<{ Rows: { Values: Record<string, string> }[] }>(page, `${CONFIGURE}.GetList`, [id])
  expect(stored.Rows.map((r) => r.Values.qty)).toEqual(['1', '3', '5', '7'])
  await cleanup(page, id)
})

// 4. Clipboard both ways: a range copies as tab/newline text, and a
// paste applies to the range AND grows the List past its last row.
test('a range copies as tab/newline text, and a paste past the last row appends rows', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const { id, glide } = await seedAndOpen(page, 'E2E grid clipboard', FOUR_ROWS)

  await dragGlideRange(page, glide, { row: 0, col: 0 }, { row: 1, col: 1 })
  await page.keyboard.press('ControlOrMeta+c')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Bolt\t1')

  // Two lines pasted into the last row: the first fits, the second is
  // past the end and becomes a new row.
  await page.evaluate(() => navigator.clipboard.writeText('Widget\t9\nGizmo\t11'))
  await clickGlideCell(page, glide, 3, 0)
  await page.keyboard.press('ControlOrMeta+v')
  await expect(glide).toHaveAttribute('data-stored-rows', '5')
  await expect(glideCellText(glide, 3, 0)).toHaveText('Widget')
  await expect(glideCellText(glide, 4, 0)).toHaveText('Gizmo')
  await cleanup(page, id)
})

// 5. A header drag resizes (per device) and reorders (the List's own
// column order); both survive a reload.
test('a header resizes to a per-device width and reorders the List’s own columns', async ({ page }) => {
  const { id, glide } = await seedAndOpen(page, 'E2E grid header drags', FOUR_ROWS)
  await expect(glide).toHaveAttribute('data-col-widths', '160,160')
  await dragGlideColumnEdge(page, glide, 0, 60)
  await expect(glide).toHaveAttribute('data-col-widths', /^2\d\d,160$/)

  // A header dragged onto its neighbour reorders the List's own columns.
  await dragGlideRange(page, glide, { row: -1, col: 1 }, { row: -1, col: 0 })
  await expect(glide).toHaveAttribute('data-col-keys', 'qty,name')

  await page.reload()
  const reloaded = await reopen(page, 'E2E grid header drags')
  // Order is the List's own (every projection, every device); the width
  // is this device's alone.
  await expect(reloaded).toHaveAttribute('data-col-keys', 'qty,name')
  await expect(reloaded).toHaveAttribute('data-col-widths', /^160,2\d\d$/)
  await cleanup(page, id)
})

// 6. The row and column menus: insert above/below and delete, on the
// grid's own context-menu events.
test('the row and column menus insert and delete rows and columns', async ({ page }) => {
  const { id, glide } = await seedAndOpen(page, 'E2E grid menus', FOUR_ROWS)
  await clickGlideCell(page, glide, 0, 0, { button: 'right' })
  await page.getByTestId('atlas-projection-insert-row').click()
  await expect(glide).toHaveAttribute('data-stored-rows', '5')

  await clickGlideCell(page, glide, 0, 0, { button: 'right' })
  await page.getByTestId('list-grid-row-delete').click()
  await expect(glide).toHaveAttribute('data-stored-rows', '4')

  await clickGlideCell(page, glide, -1, 0, { button: 'right' })
  await expect(page.getByTestId('list-grid-column-insert-left')).toBeVisible()
  await page.getByTestId('atlas-projection-insert-column').click()
  await expect(glide).toHaveAttribute('data-columns', '3')
  await cleanup(page, id)
})

// 7. A header click cycles that column's sort; the header menu narrows
// it. Both are Mill's composition on the grid, which leaves ordering
// and narrowing to the integrator by design.
test('a header click cycles the sort and the header menu filters the column', async ({ page }) => {
  const { id, glide } = await seedAndOpen(page, 'E2E grid sort filter', FOUR_ROWS)
  await clickGlideCell(page, glide, -1, 0)
  await expect(glide).toHaveAttribute('data-sort', 'name:asc')
  await expect(glideCellText(glide, 0, 0)).toHaveText('Anvil')
  await clickGlideCell(page, glide, -1, 0)
  await expect(glide).toHaveAttribute('data-sort', 'name:desc')
  await expect(glideCellText(glide, 0, 0)).toHaveText('Drill')
  await clickGlideCell(page, glide, -1, 0)
  await expect(glide).toHaveAttribute('data-sort', '')

  await clickGlideCell(page, glide, -1, 0, { button: 'right' })
  await page.getByTestId('list-grid-column-filter').click()
  await page.getByTestId('list-grid-filter-contains').fill('o') // fill: a form control (goal 0296)
  await page.getByTestId('list-grid-filter-apply').click()
  await expect(glide).toHaveAttribute('data-rows', '2')
  await expect(glide).toHaveAttribute('data-stored-rows', '4')

  await page.getByTestId('list-grid-clear-narrowing').click()
  await expect(glide).toHaveAttribute('data-rows', '4')
  await cleanup(page, id)
})

// 8. Row markers select whole rows; the toolbar acts on that selection.
test('row markers select rows and the toolbar deletes them in one action', async ({ page }) => {
  const { id, glide } = await seedAndOpen(page, 'E2E grid bulk actions', FOUR_ROWS)
  await clickGlideRowMarker(page, glide, 0)
  await clickGlideRowMarker(page, glide, 1)
  await expect(glide).toHaveAttribute('data-selected-rows', '2')
  await expect(page.getByTestId('list-grid-copy-rows')).toHaveText('Copy 2 rows')
  await page.getByTestId('list-grid-delete-rows').click()
  await expect(glide).toHaveAttribute('data-stored-rows', '2')

  // A selected column header offers its own bulk action.
  await clickGlideCell(page, glide, -1, 1)
  await expect(page.getByTestId('list-grid-delete-column')).toBeVisible()
  await page.getByTestId('list-grid-delete-column').click()
  await expect(glide).toHaveAttribute('data-columns', '1')
  await cleanup(page, id)
})

// The grid paints on a canvas and cannot follow a CSS variable: its
// palette is read from the applied scheme's tokens, and must be re-read
// when that scheme changes (goal 0349 S4 -- a grid mounted in light
// stayed light through a switch to dark).
test('the grid re-reads its palette when the color scheme changes', async ({ page }) => {
  const { id, glide } = await seedAndOpen(page, 'E2E grid theming', FOUR_ROWS)
  const light = await glide.getAttribute('data-cell-bg')
  expect(light).not.toBeNull()

  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-mill-theme', 'dark')
  await expect(glide).not.toHaveAttribute('data-cell-bg', light!)

  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-mill-theme', 'light')
  await expect(glide).toHaveAttribute('data-cell-bg', light!)
  await cleanup(page, id)
})

// 9. ⌘Z here is the app's ONE journal, the same one the board's edits
// land on (ADR-0044, goal 0352): a cell edit undoes to the value it
// replaced, and ⇧⌘Z puts the new one back.
test('(Meta+z) restores an edited cell and (Meta+Shift+z) re-applies it', async ({ page }) => {
  const { id, glide } = await seedAndOpen(page, 'E2E grid undo cell', FOUR_ROWS)
  await editGlideCell(page, glide, 0, 0, 'Widget')
  await expect(glideCellText(glide, 0, 0)).toHaveText('Widget')

  await escapeGrid(page)
  await pressUndo(page)
  await expect(glideCellText(glide, 0, 0)).toHaveText('Bolt')
  // The row itself is untouched: an undone cell edit is a cell edit.
  await expect(glide).toHaveAttribute('data-stored-rows', '4')
  await expect(glideCellText(glide, 0, 1)).toHaveText('1')

  await pressRedo(page)
  await expect(glideCellText(glide, 0, 0)).toHaveText('Widget')
  await cleanup(page, id)
})

// 10. A deleted row comes back whole -- every column, at the index it
// sat at -- and a multi-row delete is ONE step, not one per row.
test('(Meta+z) puts back a deleted row, and a bulk delete undoes in one press', async ({ page }) => {
  const { id, glide } = await seedAndOpen(page, 'E2E grid undo rows', FOUR_ROWS)
  await clickGlideCell(page, glide, 1, 0, { button: 'right' })
  await page.getByTestId('list-grid-row-delete').click()
  await expect(glide).toHaveAttribute('data-stored-rows', '3')
  await expect(glideCellText(glide, 1, 0)).toHaveText('Cog')

  await escapeGrid(page)
  await pressUndo(page)
  await expect(glide).toHaveAttribute('data-stored-rows', '4')
  await expect(glideCellText(glide, 1, 0)).toHaveText('Anvil')
  await expect(glideCellText(glide, 1, 1)).toHaveText('3')

  await clickGlideRowMarker(page, glide, 0)
  await clickGlideRowMarker(page, glide, 1)
  await page.getByTestId('list-grid-delete-rows').click()
  await expect(glide).toHaveAttribute('data-stored-rows', '2')

  await escapeGrid(page)
  await pressUndo(page)
  await expect(glide).toHaveAttribute('data-stored-rows', '4')
  await expect(glideCellText(glide, 0, 0)).toHaveText('Bolt')
  await expect(glideCellText(glide, 1, 0)).toHaveText('Anvil')
  await cleanup(page, id)
})
