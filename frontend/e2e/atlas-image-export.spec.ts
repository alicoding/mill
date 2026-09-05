import type { Download, Page } from '@playwright/test'
import { test, expect } from './fixtures/server'
import { groupCard, noteCard } from './fixtures/atlasBoard'
import { contextMenu } from './fixtures/contextMenu'
import { withClipboardLock } from './fixtures/clipboardLock'
import { hostClipboardAvailable } from './fixtures/hostClipboard'
import { callBindingViaRPC } from './fixtures/wailsRpc'
import { paletteDialog } from './fixtures/palette'
import { waitForViewportStable } from './fixtures/animation'
import { ATLAS_KIND_DOCUMENT } from './fixtures/kindPicker'

// "Copy as image" / "Export as image..." (docs/goals/0201): a picture
// of the current selection, widening to the whole board when nothing
// is selected.
//
// Shared pool. Each case builds its OWN space with its own cards and
// deletes it again, so nothing here reads or disturbs the seeded
// landing board: the cards have to sit far enough apart to be selected
// and right-clicked individually, which the landing board cannot
// promise. The copy case takes the real-pasteboard lock, since the
// host's own Go clipboard write is what it exercises.
//
// The exclusion RULES (handles, resize frames, out-of-scope nodes) are
// pinned by src/atlas/atlasImageExport.test.ts against the filter
// itself: a rasterized PNG cannot be asserted on for the ABSENCE of a
// resize handle.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const CREATE_CARD = 'github.com/alicoding/mill/internal/services/atlassvc.AtlasService.CreateCard'
const DELETE_CARD = 'github.com/alicoding/mill/internal/services/atlassvc.AtlasService.DeleteCard'

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

async function createCard(page: Page, title: string, parentID: string, position: { X: number; Y: number } | null, viewMode = '') {
  const card = await callBindingViaRPC<{ ID: string }>(page, CREATE_CARD, [
    ATLAS_KIND_DOCUMENT, title, '', null, parentID, position, viewMode, '', '', '',
  ])
  return card.ID
}

// A space of this spec's own, holding only the named cards -- built
// through the same bound call the board's own create flow ends in,
// since the gesture version cannot promise WHERE on a seeded board a
// card lands. Returns what to delete afterwards.
async function buildSpace(page: Page, spaceTitle: string, cardTitles: string[]) {
  await page.goto('/')
  // 'canvas' explicitly: a fresh container's own default view mode is
  // shelves, and this spec is about the BOARD.
  const spaceID = await createCard(page, spaceTitle, '', null, 'canvas')
  const cardIDs: string[] = []
  for (const [index, title] of cardTitles.entries()) {
    cardIDs.push(await createCard(page, title, spaceID, { X: 80 + index * 460, Y: 100 }))
  }

  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  await page.getByTestId('atlas-breadcrumb').getByText('All spaces', { exact: true }).click()
  await groupCard(page, spaceTitle).getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText(spaceTitle)
  for (const title of cardTitles) await expect(noteCard(page, title)).toBeVisible()
  // Every click and every size assertion below reads live geometry, and
  // the drill-in pan is a d3-zoom interpolation, not a CSS transition.
  await waitForViewportStable(board, 20_000)
  return { spaceID, cardIDs, board }
}

async function tearDownSpace(page: Page, spaceID: string, cardIDs: string[]) {
  for (const id of cardIDs) await callBindingViaRPC(page, DELETE_CARD, [id])
  await callBindingViaRPC(page, DELETE_CARD, [spaceID])
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

function exportDialog(page: Page) {
  return page.locator('[data-component="atlas-image-export-dialog"]')
}

async function exportAndRead(page: Page): Promise<Download> {
  const dialog = exportDialog(page)
  await expect(dialog).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  await expect(dialog).toHaveCount(0)
  return download
}

test('exports the selection at the picked scale, then widens to the whole board with nothing selected', async ({ page }) => {
  const { spaceID, cardIDs, board } = await buildSpace(page, 'ZzImgExportSpace', ['ZzImgExportA', 'ZzImgExportB'])

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
    return {
      width: (Math.max(...boxes.map((b) => b.right)) - Math.min(...boxes.map((b) => b.left))) / zoom + 64,
      height: (Math.max(...boxes.map((b) => b.bottom)) - Math.min(...boxes.map((b) => b.top))) / zoom + 64,
    }
  })

  await cardB.click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Export as image…', { exact: true }).click()
  await expect(exportDialog(page).getByTestId('atlas-image-export-scale-2')).toHaveAttribute('aria-pressed', 'true')

  const selectionDownload = await exportAndRead(page)
  // A selection names itself in the filename, so it never reads as a
  // picture of the whole board.
  expect(selectionDownload.suggestedFilename()).toBe('ZzImgExportSpace selection.png')

  const bytes = await readDownload(selectionDownload)
  expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE)
  const size = pngSize(bytes)
  expect(Math.abs(size.width - Math.round(expected.width) * 2)).toBeLessThanOrEqual(4)
  expect(Math.abs(size.height - Math.round(expected.height) * 2)).toBeLessThanOrEqual(4)

  // Nothing selected broadens to the whole board rather than refusing.
  await board.press('Escape')
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(0)
  await runViaPalette(page, 'Export as image…')
  const boardDownload = await exportAndRead(page)
  expect(boardDownload.suggestedFilename()).toBe('ZzImgExportSpace.png')
  expect((await readDownload(boardDownload)).subarray(0, 8)).toEqual(PNG_SIGNATURE)

  await tearDownSpace(page, spaceID, cardIDs)
})

test('copying says what landed on the clipboard, and whose clipboard it was', async ({ page }) => {
  await withClipboardLock(async () => {
    const { spaceID, cardIDs } = await buildSpace(page, 'ZzImgCopySpace', ['ZzImgCopyCard'])

    await noteCard(page, 'ZzImgCopyCard').click()
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)

    await runViaPalette(page, 'Copy as image')

    // This suite runs in server mode, where the picture reaches the
    // DESKTOP's clipboard: the notice says so rather than leaving it
    // to be discovered by a paste that produces nothing. Where there is
    // no real pasteboard at all (the Linux CI runner, same constraint
    // hostClipboardAvailable already names for every other clipboard
    // spec), the other half of the contract is what's provable: the
    // host's refusal reaches the same pill as a sentence, never a
    // silent no-op.
    await expect(page.getByTestId('notice-text')).toHaveText(
      hostClipboardAvailable
        ? "Copied the selection as PNG to the desktop's clipboard. This device's clipboard is unchanged."
        : "Mill couldn't put the image on the clipboard.",
      { timeout: 15_000 },
    )

    await tearDownSpace(page, spaceID, cardIDs)
  })
})
