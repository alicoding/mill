import { test, expect } from './fixtures/server'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { ATLAS_KIND_DOCUMENT, selectKind } from './fixtures/kindPicker'
import { openCard } from './fixtures/atlasBoard'
import { clickRowAction } from './inventoryRow'
import type { Locator } from '@playwright/test'

// A table card's grid deliberately swallows clicks (cell edits must
// never commit the card open) -- opening the page goes through the
// card's title, exactly what a user clicks.
const tableTitle = (card: Locator) => card.locator('[class*="title"]').first()

// List → table projection (goal 0105 minimal slice): "Table from a
// List" lands a card that renders the seeded List live and read-only,
// on the board face and on the card page. Shared worker pool: creates
// its own card and deletes it; reads (never writes) the seeded
// "Example: Country codes" List.
test('a table card projects a List live on the board and its page', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-from-list').click()
  await page.getByTestId('entity-ref-field').selectOption({ label: 'Example: Country codes' })
  // Picking the List prefilled the title with its label.
  await expect(page.getByTestId('atlas-create-title')).toHaveValue('Example: Country codes')
  await selectKind(page, ATLAS_KIND_DOCUMENT, 'atlas-create-kind')
  await page.getByRole('button', { name: 'Create' }).click()

  // The board face renders the live table: real column headers and a
  // real seeded row.
  const tableCard = page.getByTestId('atlas-table-card').filter({ hasText: 'Example: Country codes' })
  await expect(tableCard).toBeVisible()
  await expect(tableCard.getByTestId('atlas-projection-table')).toContainText('Code')
  await expect(tableCard.getByTestId('atlas-projection-table')).toContainText('US')

  // The page renders the same table plus the write-path caption.
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

// Auto-arrange packs the projection at its REAL footprint (the
// packer's own projection branch) -- the table face survives the
// action instead of being overlapped by note-sized packing.
test('auto-arrange keeps the table face at its real footprint', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-from-list').click()
  await page.getByTestId('entity-ref-field').selectOption({ label: 'Example: Country codes' })
  await selectKind(page, ATLAS_KIND_DOCUMENT, 'atlas-create-kind')
  await page.getByTestId('atlas-create-title').fill('ZzE2eProjectionArrangeCard')
  await page.getByRole('button', { name: 'Create' }).click()
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
// committing through the List's own write path (a scratch List
// created here, so the seeded one is never written).
test('boundary inserts, cell edits, and column rename all work in place on the card page', async ({ page }) => {
  await page.goto('/')
  // A scratch List via Configure, so this test owns everything it edits.
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  await page.getByTestId('new-list').click()
  await page.getByLabel('Label', { exact: true }).fill('ZzE2eProjectionEditList')
  await page.getByTestId('save-list').click()

  await page.getByRole('link', { name: 'Atlas' }).click()
  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-from-list').click()
  await page.getByTestId('entity-ref-field').selectOption({ label: 'ZzE2eProjectionEditList' })
  await selectKind(page, ATLAS_KIND_DOCUMENT, 'atlas-create-kind')
  await page.getByRole('button', { name: 'Create' }).click()

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
// is a typed Options column -- its cell renders as a colored pill, an
// options cell edits as a select over the declared values, and the
// pills density tints the row by its status color.
test('an options column renders pills, edits as a select, and the pills density tints rows', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-from-list').click()
  await page.getByTestId('entity-ref-field').selectOption({ label: 'Example: Task tracker' })
  await selectKind(page, ATLAS_KIND_DOCUMENT, 'atlas-create-kind')
  await page.getByTestId('atlas-create-title').fill('ZzE2ePillsCard')
  await page.getByRole('button', { name: 'Create' }).click()

  const tableCard = page.getByTestId('atlas-table-card').filter({ hasText: 'ZzE2ePillsCard' })
  await expect(tableCard).toBeVisible()
  // The seeded "Done" value renders as a success pill.
  const pill = tableCard.getByTestId('atlas-projection-pill').filter({ hasText: 'Done' })
  await expect(pill).toBeVisible()

  // An options cell edits as a select over the declared values.
  await pill.click()
  const select = tableCard.getByTestId('atlas-projection-cell-select')
  await expect(select).toBeVisible()
  await select.selectOption('Blocked')
  await expect(tableCard.getByTestId('atlas-projection-pill').filter({ hasText: 'Blocked' })).toBeVisible()

  // Restore the seeded row's value BEFORE the density toggle -- the
  // toggle rebuilds the node, and a cell click racing that remount
  // is its own known roughness, not this test's subject.
  await tableCard.getByTestId('atlas-projection-pill').filter({ hasText: 'Blocked' }).click()
  await tableCard.getByTestId('atlas-projection-cell-select').selectOption('Done')
  await expect(tableCard.getByTestId('atlas-projection-pill').filter({ hasText: 'Done' })).toBeVisible()

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

// Table from scratch (goal 0137, the size-picker correction): "New
// table" opens a sweepable size grid; the click IS the creation --
// no dialog, identity automatic (Reference kind, auto-unique "Table"
// title, Column N headers, empty rows at fixed height). Cleanup: the
// projection card and the List it minted.
test('New table creates a sized grid instantly from the size picker', async ({ page }) => {
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
  await page.mouse.click(400, 500)
  const tableCard = page.getByTestId('atlas-table-card').filter({ hasText: 'Table' }).first()
  await expect(tableCard).toBeVisible()
  await expect(tableCard.getByTestId('atlas-projection-table')).toContainText('Column 1')
  await expect(tableCard.getByTestId('atlas-projection-table')).toContainText('Column 3')
  await expect(tableCard.getByTestId('atlas-projection-table').locator('tbody tr')).toHaveCount(2)

  // The face carries no kind chip (the table's meaning is its
  // content), and empty rows hold a real grid height.
  await expect(tableCard.locator('[class*="glyph"]')).toHaveCount(0)
  const cellHeight = await tableCard.getByTestId('atlas-projection-cell').first().evaluate((el) => el.getBoundingClientRect().height)
  expect(cellHeight).toBeGreaterThanOrEqual(20)

  // The minted List is a real Configure entity named after the card.
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('Table', { exact: true }) })
  await expect(listRow).toBeVisible()

  // Cleanup: card first, then the List.
  await page.getByRole('link', { name: 'Atlas' }).click()
  await openCard(page, tableTitle(tableCard))
  await deleteViaPageMenu(page, page.locator('[data-component="atlas-card-overlay"]'))
  await expect(tableCard).not.toBeVisible()
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  await clickRowAction(page, listRow, 'Delete')
  await expect(listRow).toHaveCount(0)
})

// Regression (goal 0137): the hovered header lifts above its sticky
// neighbors, so the boundary ⊕ paints over the next column instead of
// under it.
test('a hovered header stacks above the neighboring sticky header', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-from-list').click()
  await page.getByTestId('entity-ref-field').selectOption({ label: 'Example: Country codes' })
  await selectKind(page, ATLAS_KIND_DOCUMENT, 'atlas-create-kind')
  await page.getByRole('button', { name: 'Create' }).click()
  const tableCard = page.getByTestId('atlas-table-card').filter({ hasText: 'Example: Country codes' })
  await expect(tableCard).toBeVisible()

  const firstTh = tableCard.locator('thead th').first()
  await firstTh.hover()
  await expect.poll(async () => firstTh.evaluate((el) => getComputedStyle(el).zIndex)).toBe('3')

  await openCard(page, tableTitle(tableCard))
  await deleteViaPageMenu(page, page.locator('[data-component="atlas-card-overlay"]'))
  await expect(tableCard).not.toBeVisible()
})

// Card resize (goal 0135): the table face is user-sizable and the
// chosen footprint persists as Card.Size -- a reload renders the
// resized box, not the default.
test('resizing a table card persists its footprint across reload', async ({ page }) => {
  // The resize DRAG synthesis is CI-invisible (pointer-coalescing
  // class, QUARANTINE.md atlas-table-resize) -- the gesture runs
  // locally; SetCardSize's bounds/persistence stay Go-tested.
  test.skip(!!process.env.CI, 'drag synthesis coalesces on CI -- QUARANTINE.md atlas-table-resize')
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-from-list').click()
  await page.getByTestId('entity-ref-field').selectOption({ label: 'Example: Country codes' })
  await selectKind(page, ATLAS_KIND_DOCUMENT, 'atlas-create-kind')
  await page.getByRole('button', { name: 'Create' }).click()
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
  const hb = await handle.boundingBox()
  if (!hb) throw new Error('no resize handle box')
  const startX = hb.x + hb.width / 2
  const startY = hb.y + hb.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(startX + i * 20, startY - i * 10)
    // The canvas library samples pointer deltas between frames --
    // coalesced synthetic moves register as zero motion, so each step
    // must land in its own frame (the recorded pointer-coalescing
    // class; no DOM-observable condition exists between raw moves).
    await page.waitForTimeout(50)
  }
  await page.mouse.up()

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
// fully inside the container.
test('the last boundary insert dot is not clipped by the card edge', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-from-list').click()
  await page.getByTestId('entity-ref-field').selectOption({ label: 'Example: Country codes' })
  await selectKind(page, ATLAS_KIND_DOCUMENT, 'atlas-create-kind')
  await page.getByRole('button', { name: 'Create' }).click()
  const tableCard = page.getByTestId('atlas-table-card').filter({ hasText: 'Example: Country codes' })
  await expect(tableCard).toBeVisible()

  const lastTh = tableCard.locator('thead th').last()
  await lastTh.hover()
  const dot = lastTh.locator('button[class*="insertDotColumn"]')
  await expect(dot).toBeVisible()
  const [dotBox, scrollBox] = await Promise.all([
    dot.boundingBox(),
    tableCard.locator('[class*="scroll"]').first().boundingBox(),
  ])
  if (!dotBox || !scrollBox) throw new Error('missing boxes')
  expect(dotBox.x + dotBox.width).toBeLessThanOrEqual(scrollBox.x + scrollBox.width + 0.5)

  // Regression: a CELL must never clip -- boundary affordances
  // straddle cell edges, and td overflow:hidden painted the row ⊕ as
  // a half-circle (text ellipsis lives on the inner span instead).
  const tdOverflow = await tableCard.getByTestId('atlas-projection-cell').first().evaluate((el) => getComputedStyle(el).overflow)
  expect(tdOverflow).toBe('visible')

  await openCard(page, tableTitle(tableCard))
  await deleteViaPageMenu(page, page.locator('[data-component="atlas-card-overlay"]'))
  await expect(tableCard).not.toBeVisible()
})

// Goal 0143: arrows walk cells INSIDE the grid -- they never nudge
// the table card on the canvas while a cell holds focus.
test('arrow keys with a focused cell never move the table card', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-size-2x2').click()
  await page.mouse.click(400, 500)
  const tableCard = page.getByTestId('atlas-table-card').filter({ hasText: 'Table' }).first()
  await expect(tableCard).toBeVisible()

  await tableCard.getByTestId('atlas-projection-cell').first().click()
  await page.getByTestId('atlas-projection-cell-input').press('Escape')
  await expect(page.locator('td[data-focused="true"]')).toHaveCount(1)

  const before = await tableCard.boundingBox()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  const after = await tableCard.boundingBox()
  expect(after?.x).toBe(before?.x)
  expect(after?.y).toBe(before?.y)
  await expect(page.locator('td[data-focused="true"]')).toHaveCount(1)

  await openCard(page, tableTitle(tableCard))
  await deleteViaPageMenu(page, page.locator('[data-component="atlas-card-overlay"]'))
  await expect(tableCard).not.toBeVisible()
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('Table', { exact: true }) })
  await clickRowAction(page, listRow, 'Delete')
  await expect(listRow).toHaveCount(0)
})


// Goal 0148: the armed size respects the canvas like every tool --
// Escape disarms without creating; a click inside a frame files the
// table into it.
test('an armed table size escapes cleanly and files into frames', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
  const tableCount = () => page.getByTestId('atlas-table-card').count()
  const before = await tableCount()

  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-size-2x2').click()
  await page.keyboard.press('Escape')
  await page.mouse.click(400, 500)
  await expect.poll(tableCount).toBe(before)

  // Armed again, clicking inside "Example area" files the table there
  // (the frame's header count grows by one).
  const frame = page.locator('[data-testid="atlas-group-card"]').filter({ hasText: 'Example area' }).first()
  const frameHeader = frame.getByTestId('atlas-group-header')
  await expect(frameHeader).toContainText('2 cards')
  const box = await frame.boundingBox()
  if (!box) throw new Error('no frame box')
  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-size-2x2').click()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 30)
  await expect(frameHeader).toContainText('3 cards')

  // Cleanup: drill in, delete the filed table card, and remove the
  // minted List.
  await frameHeader.click()
  const tableCard = page.getByTestId('atlas-table-card').filter({ hasText: 'Table' }).first()
  await expect(tableCard).toBeVisible()
  await openCard(page, tableTitle(tableCard))
  await deleteViaPageMenu(page, page.locator('[data-component="atlas-card-overlay"]'))
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('Table', { exact: true }) })
  await clickRowAction(page, listRow, 'Delete')
  await expect(listRow).toHaveCount(0)
})