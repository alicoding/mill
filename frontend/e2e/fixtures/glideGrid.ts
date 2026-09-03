import { expect, type Locator, type Page } from '@playwright/test'

// Driving the adopted canvas grid (ADR-0049) through user primitives:
// the grid paints cells on a canvas, so a cell is addressed by
// geometry the host publishes (data-col-widths / data-header-height /
// data-row-height, plus the library's own row-marker column), and its
// text is read back from the library's accessibility DOM (role=grid).
// Overlay editors mount in the body-level #portal.

const ROW_MARKER_WIDTH = 32

async function cellPoint(host: Locator, row: number, col: number): Promise<{ x: number; y: number }> {
  const widths = (await host.getAttribute('data-col-widths') ?? '').split(',').map(Number)
  const headerH = Number(await host.getAttribute('data-header-height'))
  const rowH = Number(await host.getAttribute('data-row-height'))
  const canvas = host.locator('canvas').first()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('glide canvas has no bounding box')
  // The canvas box is in screen px; the board's zoom scales it, so
  // geometry is scaled by the same factor before it is offset.
  const cssWidth = await canvas.evaluate((c) => (c as HTMLCanvasElement).offsetWidth || 1)
  const scaleX = box.width / cssWidth || 1
  const x = ROW_MARKER_WIDTH + widths.slice(0, col).reduce((a, b) => a + b, 0) + Math.min(widths[col] ?? 160, 120) / 2
  const y = row < 0 ? headerH / 2 : headerH + row * rowH + rowH / 2
  return { x: box.x + x * scaleX, y: box.y + y * scaleX }
}

// force: a cell is a painted region of one canvas, not an element --
// there is nothing per-cell for the actionability check to settle on
// (the library's second, overlay canvas shares the same origin and
// the plain click never passes its hit-target wait); the canvas
// itself is asserted visible first, and the outcome (selection, the
// portal editor, the a11y text) is what every caller asserts.
export async function clickGlideCell(page: Page, host: Locator, row: number, col: number, opts: { button?: 'left' | 'right'; clickCount?: number } = {}): Promise<void> {
  const p = await cellPoint(host, row, col)
  const canvas = host.locator('canvas').first()
  await expect(canvas).toBeVisible()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('glide canvas has no bounding box')
  await canvas.click({ position: { x: p.x - box.x, y: p.y - box.y }, button: opts.button, clickCount: opts.clickCount, force: true })
}

// The text overlay editor: a click selects the cell, a second click
// activates it (the grid's own "second-click" behavior), fill, commit
// with Enter (the spreadsheet model the grid ships).
export async function editGlideCell(page: Page, host: Locator, row: number, col: number, text: string): Promise<void> {
  await clickGlideCell(page, host, row, col)
  await clickGlideCell(page, host, row, col)
  const editor = page.locator('#portal textarea, #portal input').first()
  await expect(editor).toBeVisible()
  await editor.fill(text) // fill: a form control (goal 0296)
  await page.keyboard.press('Enter')
  await expect(editor).toHaveCount(0)
}

// The accessibility DOM's cell text (data rows only: the library's
// table has a header row first and no row-marker cell).
export function glideCellText(host: Locator, row: number, col: number): Locator {
  return host.locator('[role="grid"] [role="row"]').nth(row + 1).locator('[role="gridcell"]').nth(col)
}
