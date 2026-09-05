import { test, expect } from './fixtures/server'
import { createTableFromList, panToEmptyBoard, placeSizedTable, revealBoardObject } from './fixtures/atlasTable'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { ATLAS_KIND_DOCUMENT, selectKind } from './fixtures/kindPicker'
import { clickBoardPoint, clickFrameGutter, dragResizeHandle, openCard } from './fixtures/atlasBoard'
import { contextMenu } from './fixtures/contextMenu'
import { clickRowAction } from './inventoryRow'
import { openToolbarAction } from './fixtures/toolbarActions'
import { clickGlideCell, editGlideCell, glideCellText, openGlideCellEditor } from './fixtures/glideGrid'
import type { Locator, Page } from '@playwright/test'

// List -> table projection (goal 0105 minimal slice, relocated onto a
// board-local "table" object by goal 0179 S2): dropping a spreadsheet
// or picking a size lands a board object, never a card -- the object's
// board face renders the SAME live grid a table CARD always has, and
// Promote to card is the explicit door back to the card-only
// affordances (density toggle, resize, a card page). Tests exercising
// those card-only affordances promote first, then reuse the ORIGINAL
// card-page assertions unchanged -- proving existing table CARDS still
// work exactly as they did before this slice.

// A table card's grid deliberately swallows clicks (cell edits must
// never commit the card open) -- opening the page goes through the
// card's title, exactly what a user clicks.
const tableTitle = (card: Locator) => card.locator('[class*="title"]').first()

function tableObjects(page: Page): Locator {
  return page.locator('[data-testid="atlas-board-object"][data-object-kind="table"]')
}

async function deleteObjectViaMenu(object: Locator): Promise<void> {
  const page = object.page()
  // The grid host claims right-click for its own row/column menus
  // (ListGridGlide's onContextMenu stops propagation) -- the object's
  // own menu opens off its chrome frame instead.
  await object.getByTestId('atlas-board-object-frame').click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
}

// A table-local stand-in for fixtures/atlasBoard.ts's promoteBoardObject:
// that shared helper right-clicks the object's own bounding-box center,
// which the grid host now claims for its own row/column menus (same
// reason deleteObjectViaMenu above right-clicks the frame). Every
// caller here is a table, whose dragBand always renders the frame, so
// the same right-click target is safe -- other board-object kinds
// (dragBand: false) are the shared fixture's own concern, untouched.
async function promoteTableObject(page: Page, object: Locator, title: string, kindID: string): Promise<void> {
  const frame = object.getByTestId('atlas-board-object-frame')
  const box = await frame.boundingBox()
  if (!box) throw new Error('no frame box')
  await frame.click({ button: 'right', position: { x: box.width - 4, y: box.height / 2 } })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Promote to card…', { exact: true }).click()
  const popover = page.getByTestId('atlas-placement-popover')
  await expect(popover).toBeVisible()
  await popover.getByTestId('atlas-placement-title').fill(title)
  await selectKind(popover, kindID)
  await popover.getByTestId('atlas-placement-submit').click()
  await expect(popover).not.toBeVisible()
}

test('a table object projects a List live on the board, and Promote to card keeps it live on the page', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await createTableFromList(page, 'Country codes', 'US')

  // The board face renders the live table straight off the object --
  // no card, no kind/title question asked to get here.
  const tableObject = tableObjects(page).filter({ hasText: 'US' })
  await expect(tableObject).toBeVisible()
  await expect(tableObject.getByTestId('atlas-projection-glide').locator('[role="grid"]')).toContainText('Code')

  // Promote to card: the SAME List keeps projecting, now through the
  // card page too.
  await promoteTableObject(page, tableObject, 'Country codes', ATLAS_KIND_DOCUMENT)
  const tableCard = page.getByTestId('atlas-table-card').filter({ hasText: 'Country codes' })
  await expect(tableCard).toBeVisible()
  await expect(tableCard.getByTestId('atlas-projection-glide').locator('[role="grid"]')).toContainText('US')

  await openCard(page, tableTitle(tableCard))
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  const projection = overlay.getByTestId('atlas-page-projection')
  await expect(projection).toBeVisible()
  await expect(projection.getByTestId('atlas-projection-glide').locator('[role="grid"]')).toContainText('US')
  await expect(projection).toContainText('mirrors a List')

  // Cleanup.
  await deleteViaPageMenu(page, overlay)
  await expect(tableCard).not.toBeVisible()
})

// Auto-arrange (shelves mode) only ever packs CARDS -- a board object
// is Free-mode-only by construction (boardobject.go's own Position
// comment), so this regression stays a CARD test: promote first, then
// run the original auto-arrange assertion unchanged.
test('auto-arrange keeps a promoted table card at its real footprint', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await createTableFromList(page, 'Country codes', 'US')
  const tableObject = tableObjects(page).filter({ hasText: 'US' })
  await expect(tableObject).toBeVisible()
  await promoteTableObject(page, tableObject, 'ZzE2eProjectionArrangeCard', ATLAS_KIND_DOCUMENT)
  const tableCard = page.getByTestId('atlas-table-card').filter({ hasText: 'ZzE2eProjectionArrangeCard' })
  await expect(tableCard).toBeVisible()

  await openToolbarAction(page, 'atlas-auto-arrange')
  await expect(tableCard).toBeVisible()
  await expect(tableCard.getByTestId('atlas-projection-glide').locator('[role="grid"]')).toContainText('Code')

  // Cleanup.
  await openCard(page, tableTitle(tableCard))
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await deleteViaPageMenu(page, overlay)
})

// In-place editing (goal 0105 part 2, the draw.io-friction killer):
// a boundary insert lands a row/column exactly where pointed, a
// clicked cell edits in place, and a new column arrives named in place
// -- all committing through the List's own write path. Explicitly "on
// the card page", so this stays a promoted-card test; the write path
// itself (shared/ListGridGlide) is proven directly against the raw
// board object by the next test instead.
test('boundary inserts, cell edits, and column rename all work in place on the card page', async ({ page }) => {
  await page.goto('/')
  // A scratch List via Configure, so this test owns everything it edits.
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  await page.getByTestId('new-list').click()
  await page.getByLabel('Label', { exact: true }).fill('ZzE2eProjectionEditList')
  await page.getByTestId('save-list').click()

  await page.getByRole('link', { name: 'Atlas' }).click()
  await createTableFromList(page, 'ZzE2eProjectionEditList', 'No columns yet')
  const tableObject = tableObjects(page).filter({ hasText: 'No columns yet' })
  await expect(tableObject).toBeVisible()
  await promoteTableObject(page, tableObject, 'ZzE2eProjectionEditList', ATLAS_KIND_DOCUMENT)

  const tableCard = page.getByTestId('atlas-table-card').filter({ hasText: 'ZzE2eProjectionEditList' })
  await openCard(page, tableTitle(tableCard))
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  const glide = overlay.getByTestId('atlas-projection-glide')
  await expect(glide).toBeVisible()

  // Empty List: the honest invitation (no grid mounts with zero
  // columns), then + Column names itself in place (auto label ->
  // immediate rename input).
  await expect(glide).toContainText('No columns yet')
  await glide.getByTestId('atlas-projection-add-column').click()
  await glide.getByTestId('atlas-projection-rename-input').fill('Vendor')
  await glide.getByTestId('atlas-projection-rename-input').press('Enter')
  await expect(glide.locator('[role="columnheader"]').nth(0)).toHaveText('Vendor')

  // + Row, then edit the cell in place. The row lands through the same
  // async refetch every schema edit does -- wait for the host's own
  // row count before clicking into it, or a click can land on the
  // grid's still-shifting trailing "+ New row" hint instead.
  await glide.getByTestId('atlas-projection-add-row').click()
  await expect(glide).toHaveAttribute('data-rows', '1')
  await editGlideCell(page, glide, 0, 0, 'Acme')
  await expect(glideCellText(glide, 0, 0)).toHaveText('Acme')

  // A boundary insert on the row inserts BELOW it; fill the new row
  // and confirm the order (Acme stays first).
  await clickGlideCell(page, glide, 0, 0, { button: 'right' })
  await page.getByTestId('atlas-projection-insert-row').click()
  await expect(glide).toHaveAttribute('data-rows', '2')
  await editGlideCell(page, glide, 1, 0, 'Beta Corp')
  await expect(glideCellText(glide, 0, 0)).toHaveText('Acme')
  await expect(glideCellText(glide, 1, 0)).toHaveText('Beta Corp')

  // A boundary insert on the header inserts a column to its right.
  await clickGlideCell(page, glide, -1, 0, { button: 'right' })
  await page.getByTestId('atlas-projection-insert-column').click()
  await glide.getByTestId('atlas-projection-rename-input').fill('Status')
  await glide.getByTestId('atlas-projection-rename-input').press('Enter')
  await expect(glide.locator('[role="columnheader"]').nth(0)).toHaveText('Vendor')
  await expect(glide.locator('[role="columnheader"]').nth(1)).toHaveText('Status')

  // Cleanup: the card, then the scratch List.
  await deleteViaPageMenu(page, overlay)
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('ZzE2eProjectionEditList', { exact: true }) })
  await clickRowAction(page, listRow, 'Delete')
  await expect(listRow).toHaveCount(0)
})

// Status pills (goal 0105 part 3): the seeded tracker's Status column
// is a typed Options column -- pill rendering and select-editing are
// proven directly on the raw board object (the SAME shared grid a card
// mounts, goal 0179 S2's own "no new rendering" claim); the density
// toggle is card-only, so that half promotes first.
test('an options column renders pills and edits as a select on the board object, and the promoted card\'s pills density tints rows', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await createTableFromList(page, 'Engagement tasks', 'Set up Mill')

  // Filtered by the stable seeded task text, not the edited status
  // value below -- a filter keyed on content this test itself mutates
  // would go stale mid-test (the object's own re-query would stop
  // matching the instant the cell value it filters on changes).
  const tableObject = tableObjects(page).filter({ hasText: 'Set up Mill' })
  await expect(tableObject).toBeVisible()
  const glide = tableObject.getByTestId('atlas-projection-glide')
  // The seeded "Done" value renders as a success pill (canvas paint --
  // the DATA the pill carries is what a test can assert).
  await expect(glideCellText(glide, 0, 1)).toHaveText('Done')

  // An options cell edits as a select over the declared values.
  const select = page.getByTestId('atlas-projection-cell-select')
  await openGlideCellEditor(page, glide, 0, 1, select)
  await select.selectOption('Blocked')
  await expect(glideCellText(glide, 0, 1)).toHaveText('Blocked')

  // Restore the seeded row's value before promoting.
  await openGlideCellEditor(page, glide, 0, 1, select)
  await select.selectOption('Done')
  await expect(glideCellText(glide, 0, 1)).toHaveText('Done')

  await promoteTableObject(page, tableObject, 'ZzE2ePillsCard', ATLAS_KIND_DOCUMENT)
  const tableCard = page.getByTestId('atlas-table-card').filter({ hasText: 'ZzE2ePillsCard' })
  await expect(tableCard).toBeVisible()

  // The density toggle flips to pills (the row's status tint is canvas
  // paint, not DOM-assertable here).
  await tableCard.getByTestId('atlas-table-density-toggle').click()
  await expect(tableCard.getByTestId('atlas-table-density-toggle')).toContainText('pills')

  await openCard(page, tableTitle(tableCard))
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await deleteViaPageMenu(page, overlay)
})

// The table's own `inline` EditRoute (ADR-0046, goal 0244 S2): a text
// cell edited directly on the raw board object -- no promote, no card --
// commits through the SAME List write door (shared/ListGridGlide ->
// ConfigureService.UpdateListRow) Configure's own List page uses. A
// reload re-fetches the object's projection fresh off the backing List
// (ObjectListProjection), so the value surviving it proves the edit
// wrote through to the List entity, not just local component state.
test('a text cell edited directly on a table board object writes the backing List, surviving a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await placeSizedTable(page, '2x2')
  const tableObject = tableObjects(page).filter({ hasText: 'Column 1' })
  await expect(tableObject).toBeVisible()
  const glide = tableObject.getByTestId('atlas-projection-glide')

  await editGlideCell(page, glide, 0, 0, 'Widget')
  await expect(glideCellText(glide, 0, 0)).toHaveText('Widget')

  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  const reloaded = tableObjects(page).filter({ hasText: 'Widget' })
  await expect(reloaded).toBeVisible()
  const reloadedGlide = reloaded.getByTestId('atlas-projection-glide')
  await expect(glideCellText(reloadedGlide, 0, 0)).toHaveText('Widget')

  // Cleanup: the object, then the List it minted.
  await deleteObjectViaMenu(reloaded)
  await expect(reloaded).toHaveCount(0)
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('Table', { exact: true }) })
  await clickRowAction(page, listRow, 'Delete')
  await expect(listRow).toHaveCount(0)
})

// Table from scratch (goal 0137, relocated onto a board object by goal
// 0179 S2): "New table" opens a sweepable size grid; the click IS the
// creation -- no dialog, identity automatic (auto-unique "Table" title,
// Column N headers, empty rows at fixed height). No Kind is asked --
// a board object carries none.
test('New table creates a sized grid instantly from the size picker, landing a table object', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await page.getByTestId('atlas-tray-table').click()
  await expect(page.getByTestId('atlas-table-size-picker')).toBeVisible()
  await page.getByTestId('atlas-table-size-3x2').hover()
  await expect(page.getByTestId('atlas-table-size-label')).toContainText('3 × 2')
  await page.getByTestId('atlas-table-size-3x2').click()

  // Picking a size ARMS the tool (goal 0148) -- the click places the
  // table at that canvas point (an empty one; testing.md).
  const armedSpot = await panToEmptyBoard(page, { width: 560, height: 220 })
  await clickBoardPoint(page, { x: armedSpot.x + 12, y: armedSpot.y + 12 })
  const tableObject = tableObjects(page).filter({ hasText: 'Column 1' })
  await expect(tableObject).toBeVisible()
  const glide = tableObject.getByTestId('atlas-projection-glide')
  await expect(glide.locator('[role="grid"]')).toContainText('Column 3')
  await expect(glide).toHaveAttribute('data-rows', '2')

  // Empty rows hold a real grid height -- the host's own published row
  // height, never a collapsed row.
  await expect(glide).toHaveAttribute('data-row-height', '28')

  // The minted List is a real Configure entity named after the table.
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('Table', { exact: true }) })
  await expect(listRow).toBeVisible()

  // Cleanup: the object, then the List.
  await page.getByRole('link', { name: 'Atlas' }).click()
  await deleteObjectViaMenu(tableObject)
  await expect(tableObject).toHaveCount(0)
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  await clickRowAction(page, listRow, 'Delete')
  await expect(listRow).toHaveCount(0)
})

// A table object's own drag surface, resize handles, and content-
// following initial footprint (goal 0199 parts A-C) are covered in
// atlas-table-object.spec.ts, split out at the 500-line convention.

// Card resize (goal 0135): the table face is user-sizable and the
// chosen footprint persists as Card.Size -- this test stays scoped to
// the promoted-card path; the board object's own resize (Size, goal
// 0199 part B) has its own test below.
test('resizing a promoted table card persists its footprint across reload', async ({ page }) => {
  // The resize DRAG synthesis is CI-invisible (pointer-coalescing
  // class, QUARANTINE.md atlas-table-resize) -- the gesture runs
  // locally; SetCardSize's bounds/persistence stay Go-tested.
  test.skip(!!process.env.CI, 'drag synthesis coalesces on CI -- QUARANTINE.md atlas-table-resize')
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await createTableFromList(page, 'Country codes', 'US')
  const tableObject = tableObjects(page).filter({ hasText: 'US' })
  await expect(tableObject).toBeVisible()
  await promoteTableObject(page, tableObject, 'Country codes', ATLAS_KIND_DOCUMENT)
  const tableCard = page.getByTestId('atlas-table-card').filter({ hasText: 'Country codes' })
  await expect(tableCard).toBeVisible()

  // Layout width (flow units): a reload re-fits the viewport to a board
  // whose extents this test itself changed, so screen pixels would
  // compare two different zooms.
  const layoutWidth = (card: Locator) => card.evaluate((el) => (el as HTMLElement).offsetWidth)
  const beforeWidth = await layoutWidth(tableCard)

  // Select the node, then drag the resizer's bottom-right handle.
  await tableTitle(tableCard).click()
  // The bottom-right handle sits under the floating create toolbar
  // (which swallows the pointerdown) -- the top-right handle is clear.
  const handle = page.locator('.react-flow__resize-control.handle.top.right')
  await expect(handle).toBeVisible()
  await dragResizeHandle(page, handle, 120, -60)

  // The node grew, and the growth survives a reload (persisted Size).
  await expect.poll(() => layoutWidth(tableCard)).toBeGreaterThan(beforeWidth + 80)
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(tableCard).toBeVisible()
  await expect.poll(() => layoutWidth(tableCard)).toBeGreaterThan(beforeWidth + 80)

  await openCard(page, tableTitle(tableCard))
  await deleteViaPageMenu(page, page.locator('[data-component="atlas-card-overlay"]'))
  await expect(tableCard).not.toBeVisible()
})

// Goal 0148: the armed size respects the canvas like every tool --
// Escape disarms without creating; a click inside a frame files the
// table object into it (containment, not the frame's own card-count
// display -- a board object is deliberately excluded from that count,
// same as image/ink/shape).
test('an armed table size escapes cleanly and files into frames', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
  const objectCount = () => tableObjects(page).count()
  const before = await objectCount()

  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-size-2x2').click()
  await page.keyboard.press('Escape')
  const escapedSpot = await panToEmptyBoard(page, { width: 300, height: 200 })
  await clickBoardPoint(page, { x: escapedSpot.x + 12, y: escapedSpot.y + 12 })
  await expect.poll(objectCount).toBe(before)

  // Armed again, clicking inside "Client records" files the table
  // object there. Unlike a card/note, a board object filed into a
  // frame does NOT render nested inside the frame's own preview box at
  // the parent level (it carries no childCount contribution either,
  // atlasBuildBoardNodes.ts's own card-only childCount) -- so
  // containment is confirmed by drilling in, never by a DOM count at
  // this level.
  const frame = page.locator('[data-testid="atlas-group-card"]').filter({ hasText: 'Client records' }).first()
  await revealBoardObject(page, frame)
  const frameHeader = frame.getByTestId('atlas-group-header')
  await expect(frameHeader).toContainText('2 items')
  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-size-2x2').click()
  await clickFrameGutter(frame)

  await frameHeader.click()
  const tableObject = tableObjects(page).filter({ hasText: 'Column 1' })
  await expect(tableObject).toBeVisible()

  // Cleanup: the filed object, then the minted List.
  await deleteObjectViaMenu(tableObject)
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('Table', { exact: true }) })
  await clickRowAction(page, listRow, 'Delete')
  await expect(listRow).toHaveCount(0)
})
