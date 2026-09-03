import { test, expect } from './fixtures/server'
import { createTableFromList, placeSizedTable } from './fixtures/atlasTable'
import { dragBetween, dragResizeHandle } from './fixtures/atlasBoard'
import { contextMenu } from './fixtures/contextMenu'
import { clickRowAction } from './inventoryRow'
import type { Locator, Page } from '@playwright/test'

// A table object's own drag/resize/footprint contract (goal 0199 parts
// A-C), split out of atlas-table-projection.spec.ts at the 500-line
// convention -- that file keeps the projection/List behavior, this one
// owns the board-object-as-a-spatial-thing behavior (drag surface,
// resize handles, content-following initial footprint).

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

// Regression (goal 0199 part C): AtlasTableObjectContent used to
// render at a fixed TABLE_HEIGHT (320px) regardless of row count -- a
// short table got a box built for a much taller one. An unsized
// object's box now follows its own content instead.
test('a newly created table object has no dead space below a small grid', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await placeSizedTable(page, '2x2')
  const tableObject = tableObjects(page).filter({ hasText: 'Column 1' })
  await expect(tableObject).toBeVisible()
  const glide = tableObject.getByTestId('atlas-projection-glide')
  await expect(glide).toHaveAttribute('data-rows', '2')

  const box = await tableObject.boundingBox()
  if (!box) throw new Error('no table object box')
  // A 2-row grid's real content sits well under a fixed 320px default
  // -- bounded by the grid's own published geometry (header + rows +
  // the trailing row + the actions row and chrome), never a collapsed
  // or wrap-dependent measurement.
  expect(box.height).toBeLessThanOrEqual((2 + 1) * 28 + 32 + 80)

  await deleteObjectViaMenu(tableObject)
  await expect(tableObject).toHaveCount(0)
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('Table', { exact: true }) })
  await clickRowAction(page, listRow, 'Delete')
  await expect(listRow).toHaveCount(0)
})

// Goal 0286 (owner report: "clicked + multiple times and the table
// disappeared"): adding columns used to scroll the first columns out
// of a fixed-width box with no visible scrollbar. An unsized table now
// widens with its columns up to TABLE_MAX_WIDTH, so the first header
// stays inside the object's own box; past the cap the width holds.
test('adding columns widens an unsized table instead of scrolling its first column away, up to a cap', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await placeSizedTable(page, '2x2')
  const tableObject = tableObjects(page).filter({ hasText: 'Column 1' })
  await expect(tableObject).toBeVisible()
  const glide = tableObject.getByTestId('atlas-projection-glide')
  const startBox = await tableObject.boundingBox()
  if (!startBox) throw new Error('no table object box')

  const addColumn = async () => {
    await glide.getByTestId('atlas-projection-add-column').click()
    // Each insert opens the new column's rename field; leave it.
    await expect(glide.getByTestId('atlas-projection-rename-input')).toBeVisible()
    await page.keyboard.press('Escape')
  }
  for (let i = 0; i < 4; i++) await addColumn()
  await expect(glide).toHaveAttribute('data-columns', '6')
  await expect.poll(async () => (await tableObject.boundingBox())?.width ?? 0).toBeGreaterThan(startBox.width + 60)
  // The grid's own canvas -- where every column paints -- is still
  // inside the object's own box.
  const box = await tableObject.boundingBox()
  const canvasBox = await glide.locator('canvas').first().boundingBox()
  if (!box || !canvasBox) throw new Error('no boxes')
  expect(canvasBox.x).toBeGreaterThanOrEqual(box.x - 1)
  expect(canvasBox.x).toBeLessThanOrEqual(box.x + 40)

  // Past the cap the width holds (screen px = board units at this zoom
  // only approximately; assert it stopped growing, not an exact value).
  for (let i = 0; i < 8; i++) await addColumn()
  await expect(glide).toHaveAttribute('data-columns', '14')
  const capped = await tableObject.boundingBox()
  if (!capped) throw new Error('no capped box')
  for (let i = 0; i < 2; i++) await addColumn()
  await expect.poll(async () => (await tableObject.boundingBox())?.width ?? 0).toBeLessThanOrEqual(capped.width + 1)

  await deleteObjectViaMenu(tableObject)
  await expect(tableObject).toHaveCount(0)
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('Table', { exact: true }) })
  await clickRowAction(page, listRow, 'Delete')
  await expect(listRow).toHaveCount(0)
})

// Goal 0199 part B: NodeResizer was rendered by exactly one component
// (AtlasTableCardNode) -- a board object had a Size field and a
// SetBoardObjectSize call with no way to reach either. The resize
// persists across reload, same contract atlas-table-projection.spec.ts's
// own promoted-card resize test already proves for a promoted card.
test('a table object can be resized by its own handle, and the size persists across reload', async ({ page }) => {
  // Same CI-invisible drag synthesis atlas-table-projection.spec.ts's
  // card-resize test already documents (QUARANTINE.md atlas-table-resize).
  test.skip(!!process.env.CI, 'drag synthesis coalesces on CI -- QUARANTINE.md atlas-table-resize')
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await createTableFromList(page, 'Example: Country codes', 'US')
  const tableObject = tableObjects(page).filter({ hasText: 'US' })
  await expect(tableObject).toBeVisible()

  const before = await tableObject.boundingBox()
  if (!before) throw new Error('no table object box')

  // Select via the frame (a click inside the grid edits a cell instead).
  await tableObject.getByTestId('atlas-board-object-frame').click()
  const handle = page.locator('.react-flow__resize-control.handle.top.right')
  await expect(handle).toBeVisible()
  await dragResizeHandle(page, handle, 120, -60)

  await expect.poll(async () => (await tableObject.boundingBox())?.width ?? 0).toBeGreaterThan(before.width + 80)
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  const reloaded = tableObjects(page).filter({ hasText: 'US' })
  await expect(reloaded).toBeVisible()
  await expect.poll(async () => (await reloaded.boundingBox())?.width ?? 0).toBeGreaterThan(before.width + 80)

  await deleteObjectViaMenu(reloaded)
  await expect(reloaded).toHaveCount(0)
})

// Regression (goal 0199, the #404 correction): a table board object's
// own grid is wrapped nodrag (the spreadsheet-node convention), which
// left the object with NO surface a plain node-drag could reach once
// the table relocated off the card onto a bare board object. The
// object's own chrome band is that surface.
test('a table object can be dragged by its own frame', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await createTableFromList(page, 'Example: Country codes', 'US')
  const tableObject = tableObjects(page).filter({ hasText: 'US' })
  await expect(tableObject).toBeVisible()

  const before = await tableObject.boundingBox()
  if (!before) throw new Error('no table object box')

  const frame = tableObject.getByTestId('atlas-board-object-frame')
  const frameBox = await frame.boundingBox()
  if (!frameBox) throw new Error('no frame box')
  const start = { x: frameBox.x + frameBox.width / 2, y: frameBox.y + frameBox.height / 2 }
  await dragBetween(page, { locator: frame, position: { x: frameBox.width / 2, y: frameBox.height / 2 } }, { x: start.x + 140, y: start.y + 100 })

  await expect.poll(async () => (await tableObject.boundingBox())?.x ?? 0).toBeGreaterThan(before.x + 100)

  await deleteObjectViaMenu(tableObject)
  await expect(tableObject).toHaveCount(0)
})
