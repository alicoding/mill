import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { inflateSync } from 'node:zlib'
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
import { IMAGE_EXPORT_PADDING } from '../src/atlas/atlasImageExport'

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
const CREATE_BOARD_OBJECT = 'github.com/alicoding/mill/internal/services/atlassvc.AtlasService.CreateBoardObject'
const DELETE_BOARD_OBJECT = 'github.com/alicoding/mill/internal/services/atlassvc.AtlasService.DeleteBoardObject'

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

// Decodes an 8-bit PNG down to raw pixel bytes, no image library: walk
// the chunk stream for IHDR (bit depth/color type) and every IDAT,
// zlib-inflate them as one stream, then undo each scanline's own
// filter byte (goal 0201 follow-up needs real pixels, not just the
// IHDR header pngSize already reads, to prove the placeholder's
// outline actually rendered).
interface DecodedPng { width: number; height: number; channels: number; data: Buffer }

const PNG_CHANNELS_BY_COLOR_TYPE: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

// Walks the chunk stream once for IHDR's own bit depth/color type and
// every IDAT payload, concatenated -- split out from decodePng below
// purely to keep each function's own branching under the complexity
// gate.
function readPngChunks(bytes: Buffer): { bitDepth: number; colorType: number; idat: Buffer } {
  let offset = 8
  const idatChunks: Buffer[] = []
  let bitDepth = 8
  let colorType = 6
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    if (type === 'IHDR') {
      bitDepth = bytes.readUInt8(dataStart + 8)
      colorType = bytes.readUInt8(dataStart + 9)
    } else if (type === 'IDAT') {
      idatChunks.push(bytes.subarray(dataStart, dataStart + length))
    } else if (type === 'IEND') {
      break
    }
    offset = dataStart + length + 4 // + CRC
  }
  return { bitDepth, colorType, idat: Buffer.concat(idatChunks) }
}

// One PNG defiltering algorithm (spec section 9.2), given the three
// neighbor bytes every algorithm but None reads from.
function unfilterByte(filterType: number, rawByte: number, a: number, b: number, c: number): number {
  switch (filterType) {
    case 0: return rawByte
    case 1: return rawByte + a
    case 2: return rawByte + b
    case 3: return rawByte + Math.floor((a + b) / 2)
    case 4: return rawByte + paethPredictor(a, b, c)
    default: throw new Error(`decodePng: unsupported filter type ${filterType}`)
  }
}

function decodePng(bytes: Buffer): DecodedPng {
  const { width, height } = pngSize(bytes)
  const { bitDepth, colorType, idat } = readPngChunks(bytes)
  if (bitDepth !== 8) throw new Error(`decodePng: unsupported PNG bit depth ${bitDepth}`)
  const channels = PNG_CHANNELS_BY_COLOR_TYPE[colorType] ?? 4
  const raw = inflateSync(idat)
  const stride = width * channels
  const data = Buffer.alloc(stride * height)
  let rawOffset = 0
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawOffset]
    rawOffset += 1
    const rowStart = y * stride
    const prevRowStart = (y - 1) * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[rowStart + x - channels] : 0
      const b = y > 0 ? data[prevRowStart + x] : 0
      const c = y > 0 && x >= channels ? data[prevRowStart + x - channels] : 0
      data[rowStart + x] = unfilterByte(filterType, raw[rawOffset + x], a, b, c) & 0xff
    }
    rawOffset += stride
  }
  return { width, height, channels, data }
}

function pixelAt(png: DecodedPng, x: number, y: number): { r: number; g: number; b: number } {
  const clampedX = Math.min(Math.max(x, 0), png.width - 1)
  const clampedY = Math.min(Math.max(y, 0), png.height - 1)
  const idx = (clampedY * png.width + clampedX) * png.channels
  return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2] }
}

// Whether SOME pixel within a small window around (x, y) is close to
// the target color -- a scale/rounding tolerance for a 1px outline
// whose exact device pixel shifts by a pixel or two under retina
// scaling, never a claim the whole window matches.
function colorNearby(png: DecodedPng, x: number, y: number, target: { r: number; g: number; b: number }, windowPx = 2, tolerance = 40): boolean {
  for (let dy = -windowPx; dy <= windowPx; dy++) {
    for (let dx = -windowPx; dx <= windowPx; dx++) {
      const p = pixelAt(png, x + dx, y + dy)
      const distance = Math.abs(p.r - target.r) + Math.abs(p.g - target.g) + Math.abs(p.b - target.b)
      if (distance <= tolerance) return true
    }
  }
  return false
}

// A minimal, valid single-page PDF -- the same correct-xref shape
// atlas-seeded-board-objects.spec.ts's own linkPdfBytes builds (never
// pdf.js's lenient recovery path), minus the link annotation this
// spec doesn't need.
function minimalPdfBytes(): string {
  const content = 'BT /F1 24 Tf 72 690 Td (Zz image export pdf) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xrefAt = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  return out
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

// Two defects the screenshot review found after #682 (docs/goals/0201
// follow-up): the note card's own "Zoom into" chip is an affordance,
// not content, and a frame-backed noun (pdf, the one iframe-backed
// object) rendered as nothing at all once its iframe was filtered out.
test('capturing hides the zoom-into chip and draws a placeholder over a frame-backed noun', async ({ page }) => {
  const { spaceID, cardIDs } = await buildSpace(page, 'ZzImgPlaceholderSpace', ['ZzImgPlaceholderCard'])
  const dir = mkdtempSync(path.join(tmpdir(), 'mill-e2e-image-export-pdf-'))
  try {
    const pdfFile = path.join(dir, 'ZzImgPlaceholderDoc.pdf')
    writeFileSync(pdfFile, minimalPdfBytes())
    const pdfObject = await callBindingViaRPC<{ ID: string }>(page, CREATE_BOARD_OBJECT, [
      'pdf', { mirrorPath: pdfFile, title: 'ZzImgPlaceholderDoc' }, { X: 80, Y: 420 }, spaceID,
    ])

    const pdfNode = page.locator('[data-testid="atlas-board-object"][data-object-kind="pdf"]')
    await expect(pdfNode).toBeVisible()
    await expect(pdfNode.locator('[data-testid="atlas-pdf-viewer"]')).toBeVisible()

    // The chip's own exclusion rule and the placeholder's own outline
    // color, read directly off the live elements under a simulated
    // capture -- these are CSS-only (AtlasBoard.module.css), so this is
    // the DOM-level half of the proof; the PNG below is the rasterized
    // half.
    const capturing = await page.evaluate(() => {
      const viewport = document.querySelector('.react-flow__viewport') as HTMLElement
      const chip = document.querySelector('[data-testid="atlas-note-drill"] [data-capture-exclude]')
      const placeholder = document.querySelector('[data-testid="atlas-pdf-capture-placeholder"]') as HTMLElement
      viewport.setAttribute('data-capturing', 'true')
      const chipVisibility = chip ? getComputedStyle(chip).visibility : null
      const outlineColor = getComputedStyle(placeholder, '::after').outlineColor
      viewport.removeAttribute('data-capturing')
      return { chipVisibility, outlineColor }
    })
    expect(capturing.chipVisibility).toBe('hidden')
    const outlineMatch = /rgba?\((\d+), (\d+), (\d+)/.exec(capturing.outlineColor)
    if (!outlineMatch) throw new Error(`unresolved outline color: ${capturing.outlineColor}`)
    const outlineColor = { r: Number(outlineMatch[1]), g: Number(outlineMatch[2]), b: Number(outlineMatch[3]) }

    // Select ONLY the pdf object, so the export crop is exactly its own
    // box plus the fixed padding -- nothing else from the board can
    // paint the outline color into this picture.
    await pdfNode.locator('[data-testid="atlas-object-click-shield"]').click()
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)

    await runViaPalette(page, 'Export as image…')
    const download = await exportAndRead(page)
    const bytes = await readDownload(download)
    expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE)

    // Where the placeholder's own box sits within the exported crop,
    // expressed as a fraction of the crop -- independent of the current
    // zoom/pan and of the export's own pixel scale, both of which cancel
    // out of this ratio.
    const geometry = await page.evaluate((padding) => {
      const obj = document.querySelector('.react-flow__node.selected')!.getBoundingClientRect()
      const placeholder = document.querySelector('[data-testid="atlas-pdf-capture-placeholder"]')!.getBoundingClientRect()
      const zoom = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')!).transform).a
      const pad = padding * zoom
      const cropLeft = obj.left - pad
      const cropTop = obj.top - pad
      const cropWidth = obj.width + pad * 2
      const cropHeight = obj.height + pad * 2
      return {
        left: (placeholder.left - cropLeft) / cropWidth,
        right: (placeholder.right - cropLeft) / cropWidth,
        top: (placeholder.top - cropTop) / cropHeight,
        bottom: (placeholder.bottom - cropTop) / cropHeight,
      }
    }, IMAGE_EXPORT_PADDING)

    const png = decodePng(bytes)
    const midY = Math.round(png.height * (geometry.top + geometry.bottom) / 2)
    const leftX = Math.round(png.width * geometry.left)
    const rightX = Math.round(png.width * geometry.right) - 1
    // The 1px outline crosses this row exactly twice, at its own left
    // and right edges -- proof the placeholder actually rasterized,
    // rather than the pdf's filtered-out iframe leaving its box blank
    // (goal 0201 follow-up).
    expect(colorNearby(png, leftX, midY, outlineColor)).toBe(true)
    expect(colorNearby(png, rightX, midY, outlineColor)).toBe(true)

    // A screenshot-review hook, never engaged in CI: set
    // MILL_E2E_SAVE_EXPORT to also save the exported PNG to that path.
    const saveTo = process.env.MILL_E2E_SAVE_EXPORT
    if (saveTo) {
      mkdirSync(path.dirname(saveTo), { recursive: true })
      writeFileSync(saveTo, bytes)
    }

    await callBindingViaRPC(page, DELETE_BOARD_OBJECT, [pdfObject.ID])
    await tearDownSpace(page, spaceID, cardIDs)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
