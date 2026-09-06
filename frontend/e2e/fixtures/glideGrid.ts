import { expect, type Locator, type Page } from '@playwright/test'
import { dragBetween, type DragEndpoint } from './atlasBoardPointer'

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
// The board pans and zooms to reveal a new object; a forced click
// computed from a mid-animation box lands on whatever was under that
// point a frame ago (a seeded card, whose page then opens). Wait for
// the host's box to hold still across two frames first.
async function waitForBoxStable(host: Locator): Promise<void> {
  let last = ''
  await expect.poll(async () => {
    const box = await host.boundingBox()
    const key = box ? [box.x, box.y, box.width, box.height].map((n) => Math.round(n)).join(',') : ''
    const stable = key !== '' && key === last
    last = key
    return stable
  }, { timeout: 5000, intervals: [80, 80, 120, 200] }).toBe(true)
}

export async function clickGlideCell(page: Page, host: Locator, row: number, col: number, opts: { button?: 'left' | 'right'; clickCount?: number } = {}): Promise<void> {
  await waitForBoxStable(host)
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
// openGlideCellEditor activates a cell's overlay editor the way a user
// does under the grid's second-click model: a click on an unselected
// cell selects it and a further click activates; a click on a cell
// that is ALREADY selected (the grid keeps the last edited cell
// selected after a commit) activates at once, and a second click there
// would close what just opened. So: click, give the editor a moment to
// appear, click again only if it has not.
export async function openGlideCellEditor(page: Page, host: Locator, row: number, col: number, editor: Locator): Promise<void> {
  await clickGlideCell(page, host, row, col)
  const opened = await editor.first().waitFor({ state: 'visible', timeout: 600 }).then(() => true, () => false)
  if (!opened) await clickGlideCell(page, host, row, col)
  await expect(editor.first()).toBeVisible()
}

// The editor mounts in the body-level portal, or inside the grid's own
// portal on a focus-trapping page (ListGridGlide's editorPortal).
export function glideTextEditor(page: Page): Locator {
  return page.locator('#portal, [data-testid="atlas-projection-glide-portal"]').locator('textarea, input')
}

export async function editGlideCell(page: Page, host: Locator, row: number, col: number, text: string): Promise<void> {
  const editor = glideTextEditor(page).first()
  await openGlideCellEditor(page, host, row, col, editor)
  await editor.fill(text) // fill: a form control (goal 0296)
  await page.keyboard.press('Enter')
  await expect(editor).toHaveCount(0)
}

// The accessibility DOM's cell text (data rows only: the library's
// table has a header row first and no row-marker cell).
export function glideCellText(host: Locator, row: number, col: number): Locator {
  return host.locator('[role="grid"] [role="row"]').nth(row + 1).locator('[role="gridcell"]').nth(col)
}

// A cell's own rectangle inside the grid canvas, in CANVAS-relative CSS
// px -- the coordinate space dragBetween's (locator, offset) endpoints
// take. Row -1 is the header row.
async function cellRect(host: Locator, row: number, col: number): Promise<{ x: number; y: number; width: number; height: number }> {
  const widths = (await host.getAttribute('data-col-widths') ?? '').split(',').map(Number)
  const headerH = Number(await host.getAttribute('data-header-height'))
  const rowH = Number(await host.getAttribute('data-row-height'))
  return {
    x: ROW_MARKER_WIDTH + widths.slice(0, col).reduce((a, b) => a + b, 0),
    y: row < 0 ? 0 : headerH + row * rowH,
    width: widths[col] ?? 160,
    height: row < 0 ? headerH : rowH,
  }
}

// A drag endpoint on the grid, expressed against its SCROLLER rather
// than its canvas: the scroller is the topmost element over the grid
// area, so it is what an actionability hover can legitimately target
// (a hover on the canvas is intercepted by it and never settles). Cell
// geometry is still the canvas's own, translated into the scroller's
// box.
async function endpoint(host: Locator, row: number, col: number, at: 'center' | 'fill-handle' | 'right-edge'): Promise<DragEndpoint> {
  const rect = await cellRect(host, row, col)
  const canvas = host.locator('canvas').first()
  const scroller = host.locator('.dvn-scroller').first()
  await expect(scroller).toBeVisible()
  const canvasBox = await canvas.boundingBox()
  const scrollerBox = await scroller.boundingBox()
  if (!canvasBox || !scrollerBox) throw new Error('glide grid has no bounding box')
  // The fill handle's own hit region is a 6px radius around the
  // selection's bottom-right corner, inset 2px (the library's own
  // fillHandleClickSize).
  const local = at === 'center'
    ? { x: rect.x + Math.min(rect.width, 120) / 2, y: rect.y + rect.height / 2 }
    : at === 'fill-handle'
      ? { x: rect.x + rect.width - 2, y: rect.y + rect.height - 2 }
      : { x: rect.x + rect.width - 1, y: rect.y + rect.height / 2 }
  // A board object scales with the canvas: the grid reports unscaled
  // CSS px, the drag lands in screen px.
  const cssWidth = await canvas.evaluate((c) => (c as HTMLCanvasElement).offsetWidth || 1)
  const scale = canvasBox.width / cssWidth || 1
  return { locator: scroller, position: { x: canvasBox.x - scrollerBox.x + local.x * scale, y: canvasBox.y - scrollerBox.y + local.y * scale } }
}

// Drags a rectangular range from one cell to another -- the grid's own
// range selection, the unit copy, clear and fill all act on.
export async function dragGlideRange(page: Page, host: Locator, from: { row: number; col: number }, to: { row: number; col: number }): Promise<void> {
  await expect(host.locator('canvas').first()).toBeVisible()
  await dragBetween(page, await endpoint(host, from.row, from.col, 'center'), await endpoint(host, to.row, to.col, 'center'))
}

// Drags the fill handle at the current selection's bottom-right corner
// down (or right) to another cell.
export async function dragGlideFillHandle(page: Page, host: Locator, from: { row: number; col: number }, to: { row: number; col: number }): Promise<void> {
  await expect(host.locator('canvas').first()).toBeVisible()
  await dragBetween(page, await endpoint(host, from.row, from.col, 'fill-handle'), await endpoint(host, to.row, to.col, 'center'))
}

// Clicks Glide's own trailing row -- the "New row" affordance
// (trailingRowOptions/onRowAppended, goal 0349 S4 Part B) -- at
// whatever position the host's CURRENT row count paints it. Reads
// data-rows fresh on every call, so two clicks in a row (before the
// first append's re-render has landed) each still target wherever the
// trailing row actually sits right now.
export async function clickGlideTrailingRow(page: Page, host: Locator): Promise<void> {
  const rows = Number(await host.getAttribute('data-rows'))
  await clickGlideCell(page, host, rows, 0)
}

// Clicks a row's marker checkbox (rowMarkers="both"): the marker column
// sits left of column 0 and is always ROW_MARKER_WIDTH wide.
export async function clickGlideRowMarker(page: Page, host: Locator, row: number): Promise<void> {
  const headerH = Number(await host.getAttribute('data-header-height'))
  const rowH = Number(await host.getAttribute('data-row-height'))
  const canvas = host.locator('canvas').first()
  await expect(canvas).toBeVisible()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('glide canvas has no bounding box')
  await canvas.click({ position: { x: ROW_MARKER_WIDTH / 2, y: headerH + row * rowH + rowH / 2 }, force: true })
}

// Drags a column header's right EDGE by dx -- the grid's own resize
// gesture (the edge region is where it arms the resize, never the
// header's middle, which starts a reorder drag instead).
export async function dragGlideColumnEdge(page: Page, host: Locator, col: number, dx: number): Promise<void> {
  const from = await endpoint(host, -1, col, 'right-edge')
  await dragBetween(page, from, { locator: from.locator, position: { x: from.position.x + dx, y: from.position.y } })
}

// Types ONE character over a selected cell -- the grid's edit-on-type
// behaviour -- and returns once its overlay editor holds it. The click
// that selects a cell settles the grid's own focus a frame later, so a
// keystroke can land before anything is listening; this retries once
// against the editor's presence rather than a fixed wait, the same
// shape openGlideCellEditor uses for the second-click model.
export async function typeOverGlideCell(page: Page, host: Locator, row: number, col: number, char: string, editor: Locator): Promise<void> {
  await clickGlideCell(page, host, row, col)
  await page.keyboard.press(char)
  const opened = await editor.waitFor({ state: 'visible', timeout: 1000 }).then(() => true, () => false)
  if (!opened) {
    await clickGlideCell(page, host, row, col)
    await page.keyboard.press(char)
  }
  await expect(editor).toBeVisible()
}
