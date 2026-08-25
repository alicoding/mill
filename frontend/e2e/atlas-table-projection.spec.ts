import { test, expect } from './fixtures/server'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { ATLAS_KIND_DOCUMENT } from './fixtures/kindPicker'
import { clickBoardPoint, clickFrameGutter, dragResizeHandle, openCard, promoteBoardObject } from './fixtures/atlasBoard'
import { contextMenu } from './fixtures/contextMenu'
import { clickRowAction } from './inventoryRow'
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

async function createTableFromList(page: Page, listLabel: string): Promise<void> {
  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-from-list').click()
  await page.getByTestId('entity-ref-field').selectOption({ label: listLabel })
  await page.getByRole('button', { name: 'Create' }).click()
}

async function deleteObjectViaMenu(object: Locator): Promise<void> {
  const page = object.page()
  await object.click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
}

test('a table object projects a List live on the board, and Promote to card keeps it live on the page', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await createTableFromList(page, 'Example: Country codes')

  // The board face renders the live table straight off the object --
  // no card, no kind/title question asked to get here.
  const tableObject = tableObjects(page).filter({ hasText: 'US' })
  await expect(tableObject).toBeVisible()
  await expect(tableObject.getByTestId('atlas-projection-table')).toContainText('Code')

  // Promote to card: the SAME List keeps projecting, now through the
  // card page too.
  await promoteBoardObject(page, tableObject, 'Example: Country codes', ATLAS_KIND_DOCUMENT)
  const tableCard = page.getByTestId('atlas-table-card').filter({ hasText: 'Example: Country codes' })
  await expect(tableCard).toBeVisible()
  await expect(tableCard.getByTestId('atlas-projection-table')).toContainText('US')

  await openCard(page, tableTitle(tableCard))
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  const projection = overlay.getByTestId('atlas-page-projection')
  await expect(projection).toBeVisible()
  await expect(projection.getByTestId('atlas-projection-table')).toContainText('US')
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
  await createTableFromList(page, 'Example: Country codes')
  const tableObject = tableObjects(page).filter({ hasText: 'US' })
  await expect(tableObject).toBeVisible()
  await promoteBoardObject(page, tableObject, 'ZzE2eProjectionArrangeCard', ATLAS_KIND_DOCUMENT)
  const tableCard = page.getByTestId('atlas-table-card').filter({ hasText: 'ZzE2eProjectionArrangeCard' })
  await expect(tableCard).toBeVisible()

  await page.getByRole('button', { name: 'Auto-arrange' }).click()
  await expect(tableCard).toBeVisible()
  await expect(tableCard.getByTestId('atlas-projection-table')).toContainText('Code')

  // Cleanup.
  await openCard(page, tableTitle(tableCard))
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await deleteViaPageMenu(page, overlay)
})

// In-place editing (goal 0105 part 2, the draw.io-friction killer):
// boundary ⊕ inserts a row exactly where pointed, a clicked cell
// edits in place, and a new column arrives named in place -- all
// committing through the List's own write path. Explicitly "on the
// card page", so this stays a promoted-card test; the write path
// itself (shared/ListGrid) is proven directly against the raw board
// object by the next test instead.
test('boundary inserts, cell edits, and column rename all work in place on the card page', async ({ page }) => {
  await page.goto('/')
  // A scratch List via Configure, so this test owns everything it edits.
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  await page.getByTestId('new-list').click()
  await page.getByLabel('Label', { exact: true }).fill('ZzE2eProjectionEditList')
  await page.getByTestId('save-list').click()

  await page.getByRole('link', { name: 'Atlas' }).click()
  await createTableFromList(page, 'ZzE2eProjectionEditList')
  const tableObject = tableObjects(page).filter({ hasText: 'No columns yet' })
  await expect(tableObject).toBeVisible()
  await promoteBoardObject(page, tableObject, 'ZzE2eProjectionEditList', ATLAS_KIND_DOCUMENT)

  const tableCard = page.getByTestId('atlas-table-card').filter({ hasText: 'ZzE2eProjectionEditList' })
  await openCard(page, tableTitle(tableCard))
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  const table = overlay.getByTestId('atlas-projection-table')
  await expect(table).toBeVisible()

  // Empty List: the honest invitation, then + Column names itself in
  // place (auto label -> immediate rename input).
  await expect(table).toContainText('No columns yet')
  await table.getByTestId('atlas-projection-add-column').click()
  await table.getByTestId('atlas-projection-rename-input').fill('Vendor')
  await table.getByTestId('atlas-projection-rename-input').press('Enter')
  await expect(table.getByTestId('atlas-projection-header')).toContainText('Vendor')

  // + Row, then edit the cell in place.
  await table.getByTestId('atlas-projection-add-row').click()
  const firstCell = table.getByTestId('atlas-projection-cell').first()
  await firstCell.click()
  await table.getByTestId('atlas-projection-cell-input').fill('Acme')
  await table.getByTestId('atlas-projection-cell-input').press('Enter')
  await expect(firstCell).toContainText('Acme')

  // Boundary ⊕ on the row inserts BELOW it; fill the new row and
  // confirm the order (Acme stays first).
  await table.getByTestId('atlas-projection-row').first().hover()
  await table.getByTestId('atlas-projection-insert-row').first().click()
  await expect(table.getByTestId('atlas-projection-row')).toHaveCount(2)
  const secondCell = table.getByTestId('atlas-projection-row').nth(1).getByTestId('atlas-projection-cell').first()
  await secondCell.click()
  await table.getByTestId('atlas-projection-cell-input').fill('Beta Corp')
  await table.getByTestId('atlas-projection-cell-input').press('Enter')
  await expect(table.getByTestId('atlas-projection-row').nth(0)).toContainText('Acme')
  await expect(table.getByTestId('atlas-projection-row').nth(1)).toContainText('Beta Corp')

  // Boundary ⊕ on the header inserts a column after it.
  await table.getByTestId('atlas-projection-header').first().hover()
  await table.getByTestId('atlas-projection-insert-column').first().click()
  await table.getByTestId('atlas-projection-rename-input').fill('Status')
  await table.getByTestId('atlas-projection-rename-input').press('Enter')
  await expect(table.getByTestId('atlas-projection-header').nth(0)).toContainText('Vendor')
  await expect(table.getByTestId('atlas-projection-header').nth(1)).toContainText('Status')

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
// proven directly on the raw board object (the SAME shared/ListGrid a
// card mounts, goal 0179 S2's own "no new rendering" claim); the
// density toggle is card-only, so that half promotes first.
test('an options column renders pills and edits as a select on the board object, and the promoted card\'s pills density tints rows', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await createTableFromList(page, 'Example: Task tracker')

  // Filtered by the stable seeded task text, not the edited status
  // value below -- a filter keyed on content this test itself mutates
  // would go stale mid-test (the object's own re-query would stop
  // matching the instant the cell value it filters on changes).
  const tableObject = tableObjects(page).filter({ hasText: 'Set up Mill' })
  await expect(tableObject).toBeVisible()
  // The seeded "Done" value renders as a success pill.
  const pill = tableObject.getByTestId('atlas-projection-pill').filter({ hasText: 'Done' })
  await expect(pill).toBeVisible()

  // An options cell edits as a select over the declared values.
  await pill.click()
  const select = tableObject.getByTestId('atlas-projection-cell-select')
  await expect(select).toBeVisible()
  await select.selectOption('Blocked')
  await expect(tableObject.getByTestId('atlas-projection-pill').filter({ hasText: 'Blocked' })).toBeVisible()

  // Restore the seeded row's value before promoting.
  await tableObject.getByTestId('atlas-projection-pill').filter({ hasText: 'Blocked' }).click()
  await tableObject.getByTestId('atlas-projection-cell-select').selectOption('Done')
  await expect(tableObject.getByTestId('atlas-projection-pill').filter({ hasText: 'Done' })).toBeVisible()

  await promoteBoardObject(page, tableObject, 'ZzE2ePillsCard', ATLAS_KIND_DOCUMENT)
  const tableCard = page.getByTestId('atlas-table-card').filter({ hasText: 'ZzE2ePillsCard' })
  await expect(tableCard).toBeVisible()

  // The density toggle flips to pills and the row picks up its
  // status tint (a real computed background, not transparent).
  await tableCard.getByTestId('atlas-table-density-toggle').click()
  await expect(tableCard.getByTestId('atlas-table-density-toggle')).toContainText('pills')
  const row = tableCard.getByTestId('atlas-projection-row').first()
  await expect.poll(async () => row.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')

  await openCard(page, tableTitle(tableCard))
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await deleteViaPageMenu(page, overlay)
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
  // table at that canvas point.
  await clickBoardPoint(page, { x: 400, y: 500 })
  const tableObject = tableObjects(page).filter({ hasText: 'Column 1' })
  await expect(tableObject).toBeVisible()
  await expect(tableObject.getByTestId('atlas-projection-table')).toContainText('Column 3')
  await expect(tableObject.getByTestId('atlas-projection-table').locator('tbody tr')).toHaveCount(2)

  // Empty rows hold a real grid height.
  const cellHeight = await tableObject.getByTestId('atlas-projection-cell').first().evaluate((el) => el.getBoundingClientRect().height)
  expect(cellHeight).toBeGreaterThanOrEqual(20)

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

// Regression (goal 0137): the hovered header lifts above its sticky
// neighbors, so the boundary ⊕ paints over the next column instead of
// under it. A shared/ListGrid CSS regression -- proven directly on the
// raw board object, no promotion needed.
test('a hovered header stacks above the neighboring sticky header', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await createTableFromList(page, 'Example: Country codes')
  const tableObject = tableObjects(page).filter({ hasText: 'US' })
  await expect(tableObject).toBeVisible()

  const firstTh = tableObject.locator('thead th').first()
  await firstTh.hover()
  await expect.poll(async () => firstTh.evaluate((el) => getComputedStyle(el).zIndex)).toBe('3')

  await deleteObjectViaMenu(tableObject)
  await expect(tableObject).toHaveCount(0)
})

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
  await createTableFromList(page, 'Example: Country codes')
  const tableObject = tableObjects(page).filter({ hasText: 'US' })
  await expect(tableObject).toBeVisible()
  await promoteBoardObject(page, tableObject, 'Example: Country codes', ATLAS_KIND_DOCUMENT)
  const tableCard = page.getByTestId('atlas-table-card').filter({ hasText: 'Example: Country codes' })
  await expect(tableCard).toBeVisible()

  const before = await tableCard.boundingBox()
  if (!before) throw new Error('no table card box')

  // Select the node, then drag the resizer's bottom-right handle.
  await tableTitle(tableCard).click()
  // The bottom-right handle sits under the floating create toolbar
  // (which swallows the pointerdown) -- the top-right handle is clear.
  const handle = page.locator('.react-flow__resize-control.handle.top.right')
  await expect(handle).toBeVisible()
  await dragResizeHandle(page, handle, 120, -60)

  // The node grew, and the growth survives a reload (persisted Size).
  await expect.poll(async () => (await tableCard.boundingBox())?.width ?? 0).toBeGreaterThan(before.width + 80)
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(tableCard).toBeVisible()
  await expect.poll(async () => (await tableCard.boundingBox())?.width ?? 0).toBeGreaterThan(before.width + 80)

  await openCard(page, tableTitle(tableCard))
  await deleteViaPageMenu(page, page.locator('[data-component="atlas-card-overlay"]'))
  await expect(tableCard).not.toBeVisible()
})

// Regression: the LAST column/row boundary's insert dot straddled the
// scroll container's edge and rendered half-clipped -- it must sit
// fully inside the container. A shared/ListGrid CSS regression -- proven
// directly on the raw board object, no promotion needed.
test('the last boundary insert dot is not clipped by the object edge', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await createTableFromList(page, 'Example: Country codes')
  const tableObject = tableObjects(page).filter({ hasText: 'US' })
  await expect(tableObject).toBeVisible()

  const lastTh = tableObject.locator('thead th').last()
  await lastTh.hover()
  const dot = lastTh.locator('button[class*="insertDotColumn"]')
  await expect(dot).toBeVisible()
  const [dotBox, scrollBox] = await Promise.all([
    dot.boundingBox(),
    tableObject.locator('[class*="scroll"]').first().boundingBox(),
  ])
  if (!dotBox || !scrollBox) throw new Error('missing boxes')
  expect(dotBox.x + dotBox.width).toBeLessThanOrEqual(scrollBox.x + scrollBox.width + 0.5)

  // Regression: a CELL must never clip -- boundary affordances
  // straddle cell edges, and td overflow:hidden painted the row ⊕ as
  // a half-circle (text ellipsis lives on the inner span instead).
  const tdOverflow = await tableObject.getByTestId('atlas-projection-cell').first().evaluate((el) => getComputedStyle(el).overflow)
  expect(tdOverflow).toBe('visible')

  await deleteObjectViaMenu(tableObject)
  await expect(tableObject).toHaveCount(0)
})

// Goal 0143: arrows walk cells INSIDE the grid -- they never nudge the
// board object on the canvas while a cell holds focus.
test('arrow keys with a focused cell never move the table object', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-size-2x2').click()
  await clickBoardPoint(page, { x: 400, y: 500 })
  const tableObject = tableObjects(page).filter({ hasText: 'Column 1' })
  await expect(tableObject).toBeVisible()

  await tableObject.getByTestId('atlas-projection-cell').first().click()
  await page.getByTestId('atlas-projection-cell-input').press('Escape')
  await expect(page.locator('td[data-focused="true"]')).toHaveCount(1)

  const before = await tableObject.boundingBox()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  const after = await tableObject.boundingBox()
  expect(after?.x).toBe(before?.x)
  expect(after?.y).toBe(before?.y)
  await expect(page.locator('td[data-focused="true"]')).toHaveCount(1)

  await deleteObjectViaMenu(tableObject)
  await expect(tableObject).toHaveCount(0)
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('Table', { exact: true }) })
  await clickRowAction(page, listRow, 'Delete')
  await expect(listRow).toHaveCount(0)
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
  await clickBoardPoint(page, { x: 400, y: 500 })
  await expect.poll(objectCount).toBe(before)

  // Armed again, clicking inside "Client records" files the table
  // object there. Unlike a card/note, a board object filed into a
  // frame does NOT render nested inside the frame's own preview box at
  // the parent level (it carries no childCount contribution either,
  // atlasBuildBoardNodes.ts's own card-only childCount) -- so
  // containment is confirmed by drilling in, never by a DOM count at
  // this level.
  const frame = page.locator('[data-testid="atlas-group-card"]').filter({ hasText: 'Client records' }).first()
  const frameHeader = frame.getByTestId('atlas-group-header')
  await expect(frameHeader).toContainText('2 cards')
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
