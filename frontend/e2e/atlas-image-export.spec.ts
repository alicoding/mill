import type { Download, Page } from '@playwright/test'
import { test, expect } from './fixtures/server'
import { createCardViaTray, noteCard } from './fixtures/atlasBoard'
import { contextMenu } from './fixtures/contextMenu'
import { withClipboardLock } from './fixtures/clipboardLock'
import { paletteDialog } from './fixtures/palette'
import { ATLAS_KIND_DOCUMENT } from './fixtures/kindPicker'

// "Copy as image" / "Export as image..." (docs/goals/0201): a picture
// of the current selection, widening to the whole board when nothing
// is selected.
//
// Shared pool: every card here is created under a unique title and
// deleted at the end, and nothing reads a global count. The copy case
// takes the real-pasteboard lock, since the host's own Go clipboard
// write is what it exercises.
//
// The exclusion RULES (handles, resize frames, out-of-scope nodes) are
// pinned by src/atlas/atlasImageExport.test.ts against the filter
// itself: a rasterized PNG cannot be asserted on for the ABSENCE of a
// resize handle.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

async function readDownload(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

// A PNG's IHDR carries the pixel dimensions in the two big-endian
// uint32s at bytes 16..24 -- reading the rendered size back out
// without an image library.
function pngSize(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

async function openBoard(page: Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
}

async function deleteCard(page: Page, title: string) {
  const card = noteCard(page, title)
  await card.click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(card).toHaveCount(0)
}

// The palette door: both commands act on the board's live selection,
// which the palette itself never supplies, so this is the ordinary
// user path for driving them without a multi-selection menu open.
async function runViaPalette(page: Page, label: string) {
  await page.keyboard.press('Meta+/')
  const palette = paletteDialog(page)
  await expect(palette).toBeVisible()
  await palette.getByRole('combobox').fill(label)
  await palette.getByRole('option', { name: label, exact: true }).click()
  await expect(palette).toHaveCount(0)
}

test('exports the selection as a PNG sized to the selection plus its padding', async ({ page }) => {
  await openBoard(page)
  await createCardViaTray(page, 'ZzImgExportA', { kindID: ATLAS_KIND_DOCUMENT, at: { x: 400, y: 500 } })
  await createCardViaTray(page, 'ZzImgExportB', { kindID: ATLAS_KIND_DOCUMENT, at: { x: 700, y: 300 } })

  const cardA = noteCard(page, 'ZzImgExportA')
  const cardB = noteCard(page, 'ZzImgExportB')
  await cardA.click({ modifiers: ['Shift'] })
  await cardB.click({ modifiers: ['Shift'] })
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)

  // The board's own reading of the box it is about to picture: the
  // selection's bounds in board units, plus this goal's fixed padding
  // on every side.
  const expected = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.react-flow__node.selected')].map((n) => n.getBoundingClientRect())
    const zoom = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')!).transform).a
    const width = (Math.max(...boxes.map((b) => b.right)) - Math.min(...boxes.map((b) => b.left))) / zoom + 64
    const height = (Math.max(...boxes.map((b) => b.bottom)) - Math.min(...boxes.map((b) => b.top))) / zoom + 64
    return { width, height }
  })

  await cardB.click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Export as image…', { exact: true }).click()

  const dialog = page.locator('[data-component="atlas-image-export-dialog"]')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('atlas-image-export-scale-2')).toHaveAttribute('aria-current', 'true')

  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  await expect(dialog).toHaveCount(0)

  // A selection names itself in the filename, so it never reads as a
  // picture of the whole board.
  expect(download.suggestedFilename()).toContain(' selection.png')

  const bytes = await readDownload(download)
  expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE)
  const size = pngSize(bytes)
  expect(Math.abs(size.width - Math.round(expected.width) * 2)).toBeLessThanOrEqual(4)
  expect(Math.abs(size.height - Math.round(expected.height) * 2)).toBeLessThanOrEqual(4)

  await deleteCard(page, 'ZzImgExportA')
  await deleteCard(page, 'ZzImgExportB')
})

test('with nothing selected the export widens to the whole board and drops the selection suffix', async ({ page }) => {
  await openBoard(page)
  await createCardViaTray(page, 'ZzImgExportWhole', { kindID: ATLAS_KIND_DOCUMENT })

  await page.getByTestId('atlas-board').press('Escape')
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(0)

  await runViaPalette(page, 'Export as image…')
  const dialog = page.locator('[data-component="atlas-image-export-dialog"]')
  await expect(dialog).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).not.toContain(' selection')
  expect(download.suggestedFilename()).toMatch(/\.png$/)
  expect((await readDownload(download)).subarray(0, 8)).toEqual(PNG_SIGNATURE)

  await deleteCard(page, 'ZzImgExportWhole')
})

test('copying says what landed on the clipboard, and whose clipboard it was', async ({ page }) => {
  await withClipboardLock(async () => {
    await openBoard(page)
    await createCardViaTray(page, 'ZzImgCopy', { kindID: ATLAS_KIND_DOCUMENT })

    const card = noteCard(page, 'ZzImgCopy')
    await card.click()
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)

    await runViaPalette(page, 'Copy as image')

    // This suite runs in server mode, where the picture reaches the
    // DESKTOP's clipboard: the notice says so rather than leaving it
    // to be discovered by a paste that produces nothing.
    await expect(page.getByTestId('notice-text')).toHaveText(
      "Copied the selection as PNG to the desktop's clipboard. This device's clipboard is unchanged.",
      { timeout: 15_000 },
    )

    await deleteCard(page, 'ZzImgCopy')
  })
})
