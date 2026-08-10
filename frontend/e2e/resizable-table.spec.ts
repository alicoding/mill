import { test, expect } from '@playwright/test'

// The shared long-column table pattern (shared/ResizableTable.tsx):
// drag-resizable columns on every DataTable surface, plus truncated
// cells that reveal their full value on hover via the native title
// tooltip. Verified live during the tab-shell session against the
// Integrations table; committed here per .claude/rules/testing.md so
// the manual reproduction isn't lost. Uses the seeded built-in
// requests (top-up seeding guarantees they exist on a fresh store), so
// nothing is created and nothing needs cleanup.

test('Table columns are drag-resizable and long cells truncate with a hover title', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('button', { name: 'Table view' }).click()

  const table = page.getByRole('table', { name: 'Integrations' })
  await expect(table).toBeVisible()

  // Every header except the last gets a resize handle.
  const handles = table.locator('[data-testid="column-resize-handle"]')
  const headerCount = await table.locator('thead th').count()
  await expect(handles).toHaveCount(headerCount - 1)

  // Dragging the first handle rewrites the grid's first track width.
  const firstTrack = () =>
    table.evaluate((t) => parseFloat(getComputedStyle(t).gridTemplateColumns.split(' ')[0]))
  const before = await firstTrack()
  const box = await handles.first().boundingBox()
  if (!box) throw new Error('resize handle has no bounding box')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 120, y, { steps: 4 })
  await page.mouse.up()
  const after = await firstTrack()
  expect(after).toBeGreaterThan(before + 100)

  // The resized width persists across a reload (per-table localStorage,
  // reapplied by ResizableTableContainer).
  await page.reload()
  await page.getByRole('link', { name: 'Configure' }).click()
  await expect(table).toBeVisible()
  const persisted = await firstTrack()
  expect(persisted).toBeGreaterThan(before + 100)

  // Double-clicking a handle resets to default widths and clears the
  // saved state (the divider-double-click reset convention).
  await handles.first().dblclick()
  const resetWidth = await firstTrack()
  expect(resetWidth).toBeLessThan(persisted - 50)
  const savedAfterReset = await page.evaluate(() => localStorage.getItem('mill-cols-requests'))
  expect(savedAfterReset).toBeNull()

  // The URL column renders TruncatedCell: ellipsis styling plus the
  // full value available on hover via title.
  const urlCell = table.locator(`span[title="https://postman-echo.com/oauth1"]`)
  await expect(urlCell).toBeVisible()
  await expect(urlCell).toHaveCSS('text-overflow', 'ellipsis')

  // Restore card view so other specs sharing localStorage see the default.
  await page.getByRole('button', { name: 'Card view' }).click()
})

test('Tables fit their container by default — no horizontal overflow from long columns', async ({ page }) => {
  await page.goto('/')
  // The Workflows table's Description column carries long seeded text;
  // width: 'growCollapse' + TruncatedCell must keep the grid inside
  // the container instead of forcing a horizontal scroll (the
  // reported default-layout bug).
  await page.getByRole('button', { name: 'Table view' }).click()
  const table = page.getByRole('table', { name: 'Saved workflows' })
  await expect(table).toBeVisible()
  const overflow = await table.evaluate((t) => {
    const scroller = t.parentElement as HTMLElement
    return scroller.scrollWidth - scroller.clientWidth
  })
  expect(overflow).toBeLessThanOrEqual(1)
  await page.getByRole('button', { name: 'Card view' }).click()
})
