import { test, expect } from './fixtures/server'
import { dragBetween } from './fixtures/atlasBoard'
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

// Regression (goal 0199 part C): AtlasTableObjectContent used to
// render at a fixed TABLE_HEIGHT (320px) regardless of row count -- a
// short table got a box built for a much taller one. An unsized
// object's box now follows its own content instead.
test('a newly created table object has no dead space below a small grid', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-size-2x2').click()
  await page.mouse.click(400, 500)
  const tableObject = tableObjects(page).filter({ hasText: 'Column 1' })
  await expect(tableObject).toBeVisible()
  await expect(tableObject.getByTestId('atlas-projection-table').locator('tbody tr')).toHaveCount(2)

  const box = await tableObject.boundingBox()
  if (!box) throw new Error('no table object box')
  // A 2-row grid's real content sits well under the old fixed 320px
  // default -- measuring the box itself, never anything wrap-dependent.
  expect(box.height).toBeLessThan(200)

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
  await createTableFromList(page, 'Example: Country codes')
  const tableObject = tableObjects(page).filter({ hasText: 'US' })
  await expect(tableObject).toBeVisible()

  const before = await tableObject.boundingBox()
  if (!before) throw new Error('no table object box')

  // Select via the frame (a click inside the grid edits a cell instead).
  await tableObject.getByTestId('atlas-board-object-frame').click()
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
    // Pointer-coalescing class (atlas-table-projection.spec.ts's own
    // card-resize test has the full reasoning) -- each step must land
    // in its own frame.
    await page.waitForTimeout(50)
  }
  await page.mouse.up()

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
  await createTableFromList(page, 'Example: Country codes')
  const tableObject = tableObjects(page).filter({ hasText: 'US' })
  await expect(tableObject).toBeVisible()

  const before = await tableObject.boundingBox()
  if (!before) throw new Error('no table object box')

  const frame = tableObject.getByTestId('atlas-board-object-frame')
  const frameBox = await frame.boundingBox()
  if (!frameBox) throw new Error('no frame box')
  const start = { x: frameBox.x + frameBox.width / 2, y: frameBox.y + frameBox.height / 2 }
  await dragBetween(page, start, { x: start.x + 140, y: start.y + 100 })

  await expect.poll(async () => (await tableObject.boundingBox())?.x ?? 0).toBeGreaterThan(before.x + 100)

  await deleteObjectViaMenu(tableObject)
  await expect(tableObject).toHaveCount(0)
})
