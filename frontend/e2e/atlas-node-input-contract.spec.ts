import { test, expect } from './fixtures/server'
import type { Locator, Page } from '@playwright/test'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBoardObjectViaRPC, ATLAS_DEFAULT_SPACE_ID } from './fixtures/atlasNativeDropEscapeHatch'
import { dragBetween } from './fixtures/atlasBoard'
import { waitForViewportStable } from './fixtures/animation'
import { trackpadWheelAt, wheelAt } from './fixtures/pointer'
import { pdfBytes } from './fixtures/pdfBytes'
import { openAtlas, placeSizedTable, revealBoardObject } from './fixtures/atlasTable'
import { glideTextEditor, openGlideCellEditor } from './fixtures/glideGrid'
import { contextMenu } from './fixtures/contextMenu'

// Goal 0354: ONE input contract between the canvas and the widget
// inside a board object, proven the same way for every noun that
// declares an interactive face. Each noun walks the same three states
// -- idle, selected, editing -- and the same assertions decide who owns
// the wheel, the drag and the keys in each. A per-noun input flag used
// to decide these one Kind at a time, and the answers disagreed: a
// selected table could not scroll sideways because no flag put the
// canvas's wheel opt-out on its box.
//
// Shared pool: every object here is created and deleted by the test
// that uses it, and every locator is scoped to that object. The plugin
// face's own half of this contract rides runtime-plugins.spec.ts, which
// already owns the dedicated server a plugins directory needs.

// A noun under the contract: how to create one, what inside it is a
// real scroll container (the thing a wheel over it must reach), and
// whether it has an in-place editor to walk into the editing state.
interface InputNoun {
  kind: string
  hint: string
  scroller: ((object: Locator) => Locator) | null
  // Which axis that scroller really overflows on, and so which delta a
  // wheel over it must move.
  scrollAxis: 'left' | 'top'
  // Where this face's own content currently sits, as a comparable
  // signature -- a scroller's offsets, a vendored engine's drawing
  // position. What "the face, not the board, moved" is read from. null
  // where the face is an opaque embed whose own movement this harness
  // cannot observe (a PDF renders in its own frame): there the board
  // holding still is the whole assertion.
  faceOffset: ((object: Locator) => Promise<string>) | null
  editable: boolean
  create: (page: Page, dir: string) => Promise<Locator>
}

// Deeper than an unsized sheet's own 320px cap, so its preview really
// scrolls rather than merely declaring overflow: auto.
const TALL_CSV = ['a,b,c,d', ...Array.from({ length: 40 }, (_, r) => `r${r}c0,r${r}c1,r${r}c2,r${r}c3`)].join('\n')
const E2E_DIR = path.dirname(fileURLToPath(import.meta.url))

// Reveals the object clear of the board's own fixed chrome: the toolbar
// floats over the board's top edge, so an object panned to the board's
// own margin can still sit under it -- and the band is the object's top
// 14 pixels.
async function revealBelowChrome(page: Page, object: Locator): Promise<void> {
  const board = page.getByTestId('atlas-board')
  await revealBoardObject(page, object)
  const toolbar = await page.getByTestId('atlas-toolbar').boundingBox()
  const box = await object.boundingBox()
  if (!toolbar || !box) return
  const overlap = toolbar.y + toolbar.height + 16 - box.y
  if (overlap <= 0) return
  await wheelAt(page, board, 0, -overlap, { x: 24, y: 24 })
  await waitForViewportStable(board)
}

// A dropped-file noun: the RPC escape hatch lands it (no user gesture
// in this harness can reach a native drop), then the board is reloaded
// so the object renders, and it is panned into view.
async function dropNoun(page: Page, kind: string, file: string, y: number): Promise<Locator> {
  await createBoardObjectViaRPC(page, kind, { mirrorPath: file }, { X: 40, Y: y }, ATLAS_DEFAULT_SPACE_ID)
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
  const object = page.locator(`.react-flow__node:not([data-id^="atlas-object-example-"]) [data-testid="atlas-board-object"][data-object-kind="${kind}"]`).first()
  await expect(object).toBeVisible()
  await revealBoardObject(page, object)
  return object
}

const NOUNS: InputNoun[] = [
  {
    kind: 'table',
    hint: 'Click to select, then click a cell to edit',
    scroller: (object) => object.locator('.dvn-scroller').first(),
    scrollAxis: 'left',
    faceOffset: (object) => scrollSignature(object.locator('.dvn-scroller').first()),
    editable: true,
    create: async (page) => {
      const object = await placeSizedTable(page, '5x5')
      // placeSizedTable leaves the object selected; this contract walks
      // from idle, so hand the board back its own selection first.
      await page.getByTestId('atlas-board').click({ position: { x: 8, y: 8 } })
      await expect(object).toHaveAttribute('data-activation', 'idle')
      return object
    },
  },
  {
    kind: 'sheet',
    hint: 'Click to select, then scroll or edit.',
    scroller: (object) => object.getByTestId('atlas-object-sheet-grid').locator('xpath=..'),
    scrollAxis: 'top',
    faceOffset: (object) => scrollSignature(object.getByTestId('atlas-object-sheet-grid').locator('xpath=..')),
    editable: true,
    create: async (page, dir) => {
      const file = path.join(dir, 'ZzE2eInputContract.csv')
      writeFileSync(file, TALL_CSV)
      return dropNoun(page, 'sheet', file, 940)
    },
  },
  {
    kind: 'diagram',
    hint: 'Click to select, then drag to pan',
    scroller: null,
    scrollAxis: 'top',
    // The vendored pan/zoom engine claims the wheel itself -- a .drawio
    // mirror, not a mermaid one, because only that host owns a wheel.
    faceOffset: drawingOrigin,
    editable: false,
    create: async (page, dir) => {
      const file = path.join(dir, 'ZzE2eInputContract.drawio')
      copyFileSync(path.join(E2E_DIR, 'fixtures', 'diagram-pick.drawio'), file)
      return dropNoun(page, 'diagram', file, 1320)
    },
  },
  {
    kind: 'pdf',
    hint: 'Click to select, then scroll to read',
    scroller: null,
    scrollAxis: 'top',
    faceOffset: null,
    editable: false,
    create: async (page, dir) => {
      const file = path.join(dir, 'ZzE2eInputContract.pdf')
      writeFileSync(file, pdfBytes())
      return dropNoun(page, 'pdf', file, 1700)
    },
  },
]

function viewportTransform(page: Page): Promise<string> {
  return page.locator('.react-flow__viewport').evaluate((el) => el.style.transform)
}

function scrollOffsets(scroller: Locator): Promise<{ left: number; top: number }> {
  return scroller.evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop }))
}

// A scroller's position as one comparable string.
async function scrollSignature(scroller: Locator): Promise<string> {
  const { left, top } = await scrollOffsets(scroller)
  return `${Math.round(left)},${Math.round(top)}`
}

// Where the DRAWING sits inside a diagram face, in page pixels. The
// vendored viewer keeps its graph behind its own closure and publishes
// no handle, and its view translate is applied by repositioning every
// cell -- so the first vertex's own on-screen rect is that translate
// made observable, and it moves if and only if the graph panned.
async function drawingOrigin(object: Locator): Promise<string> {
  const cell = object.locator('svg rect').first()
  const box = await cell.boundingBox()
  return `${Math.round(box?.x ?? 0)},${Math.round(box?.y ?? 0)}`
}

// A point on the chrome band, in the band's own SCREEN pixels: the band
// is 14 CSS px tall and the board renders its objects scaled, so a fixed
// offset walks off the band at anything but zoom 1.
async function bandPoint(band: Locator): Promise<{ x: number; y: number }> {
  const box = await band.boundingBox()
  if (!box) throw new Error('the chrome band has no bounding box')
  return { x: 6, y: box.height / 2 }
}

// The object's own left edge, rounded -- what a drag either moves or
// leaves alone.
async function objectLeft(object: Locator): Promise<number> {
  const box = await object.boundingBox()
  return Math.round(box?.x ?? 0)
}

async function deleteViaBand(object: Locator): Promise<void> {
  const page = object.page()
  await object.getByTestId('atlas-board-object-frame').click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(object).toHaveCount(0)
}

for (const noun of NOUNS) {
  test(`the ${noun.kind} face follows the one activation contract: idle, selected, editing`, async ({ page }) => {
    const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-input-${noun.kind}-`))
    try {
      await openAtlas(page)
      const object = await noun.create(page, dir)
      const board = page.getByTestId('atlas-board')
      await revealBelowChrome(page, object)
      const band = object.getByTestId('atlas-board-object-frame')
      const face = object.getByTestId('atlas-board-object-face')
      const shield = object.getByTestId('atlas-object-click-shield')

      // Idle: the face is inert behind the shield, the band says what
      // the first click buys, and hovering draws the ring that makes
      // the object legible as interactive before the click is spent.
      await expect(object).toHaveAttribute('data-activation', 'idle')
      await expect(shield).toHaveCount(1)
      await expect(band).toHaveAttribute('title', noun.hint)
      await expect(face).not.toHaveClass(/nowheel/)
      await object.hover()
      await expect(object).not.toHaveCSS('box-shadow', 'none')

      // Idle wheel: the canvas owns it, exactly as over any body. The
      // reverse wheel restores the viewport (panOnScroll is a 1:1
      // delta), keeping the geometry the drag below measures intact.
      await waitForViewportStable(board)
      const idleTransform = await viewportTransform(page)
      await trackpadWheelAt(page, shield, 'top', 1)
      await expect.poll(() => viewportTransform(page)).not.toBe(idleTransform)
      await trackpadWheelAt(page, shield, 'top', -1)
      await expect.poll(() => viewportTransform(page)).toBe(idleTransform)

      // The first click selects the OBJECT, never something inside the
      // face -- and only then does the face go live.
      await shield.click()
      await expect(object).toHaveAttribute('data-activation', 'selected')
      await expect(shield).toHaveCount(0)
      // The opt-out rides the FACE, never the whole node box: the chrome
      // band is a sibling of the face, so it stays with the canvas and a
      // selected object never becomes a dead zone.
      await expect(face).toHaveClass(/nowheel/)
      await expect(object).not.toHaveClass(/nowheel/)

      // Selected wheel, over the face: the face owns it OUTRIGHT. A
      // trackpad burst -- ten small deltas, the shape a trackpad and its
      // momentum tail really deliver -- moves what the face renders and
      // leaves the board exactly where it was, whether the face is a DOM
      // scroller or a vendored engine that pans without ever being one.
      await waitForViewportStable(board)
      const liveTransform = await viewportTransform(page)
      const readFace = noun.faceOffset
      const faceBefore = readFace ? await readFace(object) : null
      const wheelTarget = noun.scroller ? noun.scroller(object) : face
      if (noun.scroller) await expect(wheelTarget).toBeVisible()
      await trackpadWheelAt(page, wheelTarget, noun.scrollAxis, 1)
      if (readFace) await expect.poll(() => readFace(object)).not.toBe(faceBefore)
      await expect.poll(() => viewportTransform(page)).toBe(liveTransform)

      // Selected wheel, over the object's own chrome: the band is frame,
      // not face -- it sits outside the face's opt-out, so the canvas
      // owns it and the board pans. A live face never turns the whole
      // object into a dead zone. The band travels with the pan and is
      // 14 CSS px tall, so the burst's later events land past it: what
      // this pins is that a wheel the band receives reaches the canvas,
      // never how far one gesture carries the board.
      await trackpadWheelAt(page, band, 'top', 1, await bandPoint(band))
      await expect.poll(() => viewportTransform(page)).not.toBe(liveTransform)
      // Bring the object back clear of the toolbar before the drag
      // below measures against it -- panned from the BOARD's own
      // corner, since the wheel just moved the band itself.
      await revealBelowChrome(page, object)
      await waitForViewportStable(board)

      // The band drags the object; the live face does not. The drag
      // runs ALONG the band rather than down into the face: the object
      // travels with the pointer, so a downward path would cross into
      // an embedded viewer's own frame, which swallows every move
      // after the press.
      const startX = await objectLeft(object)
      const bandBox = await band.boundingBox()
      if (!bandBox) throw new Error('the chrome band has no bounding box')
      // The drag's END is a bare page point, never an element-bound
      // one: the object itself is what moves, so nothing owns the
      // release pixel by the time the pointer gets there
      // (dragBetween's own endpoint contract).
      await dragBetween(page, { locator: band, position: await bandPoint(band) }, { x: bandBox.x + 80, y: bandBox.y + bandBox.height / 2 })
      await expect.poll(() => objectLeft(object)).not.toBe(startX)
      // The live face is NOT a drag surface: a drag inside it reaches
      // only the face (a range selection, an engine's own pan).
      const movedX = await objectLeft(object)
      const faceBox = await object.boundingBox()
      if (!faceBox) throw new Error('the object has no bounding box')
      await dragBetween(page, { locator: object, position: { x: 30, y: 44 } }, { x: faceBox.x + 80, y: faceBox.y + 74 })
      await expect.poll(() => objectLeft(object)).toBe(movedX)

      if (noun.editable) {
        await openEditor(page, noun, object)
        await expect(object).toHaveAttribute('data-activation', 'editing')
        await page.keyboard.press('Escape')
        await expect(object).toHaveAttribute('data-activation', 'selected')
      }

      // Click-away returns every noun to idle: the shield is back and
      // the canvas owns the wheel again.
      await board.click({ position: { x: 8, y: 8 } })
      await expect(object).toHaveAttribute('data-activation', 'idle')
      await expect(object.getByTestId('atlas-object-click-shield')).toHaveCount(1)

      await deleteViaBand(object)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

// Opening each editable face's own in-place editor, through the
// gesture that face actually ships: the grid's second-click cell
// activation, the sheet preview's double-click.
async function openEditor(page: Page, noun: InputNoun, object: Locator): Promise<void> {
  if (noun.kind === 'table') {
    const host = object.getByTestId('atlas-projection-glide')
    await openGlideCellEditor(page, host, 0, 0, glideTextEditor(page))
    return
  }
  await object.getByTestId('atlas-object-sheet-grid').locator('tbody tr').first().locator('td').first().dblclick()
  await expect(object.getByTestId('atlas-object-sheet-cell-input')).toBeVisible()
}
