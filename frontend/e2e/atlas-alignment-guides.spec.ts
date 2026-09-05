import { expect, test } from './fixtures/server'
import type { Locator, Page } from '@playwright/test'
import { createCardViaTray, deleteCardViaMenu, dragBetween, noteCard } from './fixtures/atlasBoard'
import { contextMenu } from './fixtures/contextMenu'
import { findEmptyBoardRect, rectsOverlap, type Rect } from './fixtures/atlasEmptyRegion'

// Alignment guides while dragging on the board (goal 0161 slice 2):
// the accent line that appears when a dragged card's edge or centre
// comes within eight screen pixels of a peer's, the snap that puts it
// exactly there, and ⌘ as the momentary way out of both.
//
// Shared pool (testing.md): every card here is created and deleted by
// the test that uses it, and every assertion is scoped to those cards
// -- nothing reads a global count or a seeded card's position.

const GUIDE = '[data-testid="atlas-alignment-guide"]'
// The deliberate gap the ⌘ drag aims at, in screen pixels: inside the
// eight-pixel threshold, so a drop that does NOT close it proves the
// snap was suppressed rather than simply out of reach.
const CMD_GAP = 6
// How much further away every OTHER alignment on the board has to sit
// for the intended one to be the unambiguous winner.
const CLEARANCE = 5
// How far the chosen column may drift once the new card has landed and
// the board has settled around it. Tried in turn: widest first,
// relaxing on a crowded board, where the post-placement re-check is the
// backstop.
const SETTLE_MARGINS = [28, 12, 0]
// Where the coarse approach parks the card before the precise one:
// clear of the eight-pixel threshold, but close enough that the precise
// drag's own rounding stays inside a pixel or two.
const COARSE_GAP = 16
// Room for a card plus breathing space around it, in screen pixels at
// the board's settled zoom -- tried in turn, since how much clear board
// there is depends on where the seeded content has settled.
const CARD_SLOTS = [{ width: 240, height: 160 }, { width: 200, height: 140 }, { width: 175, height: 125 }]

function cardWrapper(page: Page, title: string): Locator {
  return page.locator('.react-flow__node').filter({ has: page.locator(`[aria-label="Open ${title}"]`) })
}

async function screenBox(target: Locator): Promise<Rect> {
  const box = await target.boundingBox()
  if (!box) throw new Error('the element has no bounding box')
  return box
}

// The node wrapper's own transform IS its board position: React Flow
// writes translate(<x>px,<y>px) straight from the stored coordinate,
// so this reads board units, never a zoom-scaled screen box.
async function boardX(page: Page, title: string): Promise<number> {
  const transform = await cardWrapper(page, title).evaluate((el) => (el as HTMLElement).style.transform)
  const parsed = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(transform)
  if (!parsed) throw new Error(`no board position on ${title}: "${transform}"`)
  return Number(parsed[1])
}

async function nodeRects(page: Page, exclude: (string | null)[] = []): Promise<Rect[]> {
  return page.locator('.react-flow__node').evaluateAll((els, ids) => els
    .filter((el) => !ids.includes((el as HTMLElement).dataset.id ?? ''))
    .map((el) => {
      const rect = el.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }), exclude)
}

// The first clear spot big enough for a card, narrowing what "big
// enough" means until one is found.
async function emptySlot(page: Page, board: Locator, chrome: Locator[]): Promise<{ x: number; y: number }> {
  let last: unknown
  for (const slot of CARD_SLOTS) {
    try {
      return await findEmptyBoardRect(page, board, slot.width, slot.height, chrome)
    } catch (err) {
      last = err
    }
  }
  throw last
}

async function chromeRects(locators: Locator[]): Promise<Rect[]> {
  const rects: Rect[] = []
  for (const locator of locators) {
    if (!(await locator.isVisible().catch(() => false))) continue
    const box = await locator.boundingBox()
    if (box) rects.push(box)
  }
  return rects
}

// Every vertical line the board's other nodes offer -- each one's left
// edge, centre and right edge. These are what a dragged card could
// align to INSTEAD of the card a test is about, so each approach is
// planned against what is actually rendered rather than an assumed
// empty board (the content-agnostic discipline
// fixtures/atlasEmptyRegion.ts follows).
function verticalLines(rects: Rect[]): number[] {
  return rects.flatMap((r) => [r.x, r.x + r.width / 2, r.x + r.width])
}

// Whether a card resting against `anchorLeft` would have the intended
// alignment as its nearest one, with room to spare, at both aims the
// tests use. `viaCentre` rests the dragged card's own CENTRE, rather
// than its left edge, on the target line.
function columnIsClear(anchorLeft: number, moverWidth: number, viaCentre: boolean, lines: number[]): boolean {
  const base = viaCentre ? anchorLeft - moverWidth / 2 : anchorLeft
  return [0, CMD_GAP].every((aim) => {
    const moverLines = [base + aim, base + aim + moverWidth / 2, base + aim + moverWidth]
    const nearest = Math.min(...lines.map((line) => Math.min(...moverLines.map((m) => Math.abs(line - m)))))
    return nearest > CMD_GAP + CLEARANCE
  })
}

function columnWorks(left: number, width: number, lines: number[], margin: number): boolean {
  return [-margin, 0, margin].every((drift) =>
    columnIsClear(left + drift, width, false, lines) && columnIsClear(left + drift, width, true, lines))
}

// Where the dragged card comes to rest for each alignment this file
// exercises: on the anchor's own column, and half a card left of it.
function restingFootprints(left: number, card: Rect, moverRow: number): Rect[] {
  return [left, left - card.width / 2].map((x) => ({ x, y: moverRow, width: card.width, height: card.height }))
}

function usableColumnInRow(board: Rect, top: number, card: Rect, lines: number[], occupied: Rect[], chrome: Rect[], moverRow: number, margin: number): number | null {
  for (let left = board.x + 20; left + card.width < board.x + board.width - 20; left += 8) {
    const footprint = { x: left - 12, y: top - 12, width: card.width + 24, height: card.height + 24 }
    if (occupied.some((r) => rectsOverlap(footprint, r))) continue
    // A card that ends its drag under the zoom controls or the
    // creation tray can no longer be right-clicked for cleanup.
    if (restingFootprints(left, card, moverRow).some((rest) => chrome.some((r) => rectsOverlap(rest, r)))) continue
    if (columnWorks(left, card.width, lines, margin)) return left
  }
  return null
}

// Picks the spot to create the anchor card in: a footprint clear of
// every rendered node and of the board's fixed chrome (a new card
// overlapping a region frame makes the board nudge that frame aside,
// moving the very lines this test measures), on a different row from
// the card that will be dragged, in a column where the intended
// alignment is the nearest one on offer.
function planAnchorSpot(board: Rect, card: Rect, lines: number[], occupied: Rect[], chrome: Rect[], moverRow: number): { x: number; y: number } {
  for (const margin of SETTLE_MARGINS) {
    for (let top = board.y + 30; top + card.height < board.y + board.height - 30; top += 50) {
      // The dragged card travels along its own row, so the anchor has
      // to sit on another one: a card that ends a drag underneath
      // another is unreachable for the cleanup click.
      if (Math.abs(top - moverRow) < card.height + 20) continue
      const left = usableColumnInRow(board, top, card, lines, occupied, chrome, moverRow, margin)
      if (left !== null) return { x: left, y: top }
    }
  }
  throw new Error('this board offers no clear spot where the intended alignment would be the nearest one')
}

async function dragCardByPointer(page: Page, title: string, dx: number, onArrived?: () => Promise<void>): Promise<void> {
  const box = await screenBox(cardWrapper(page, title))
  await dragBetween(
    page,
    { locator: noteCard(page, title), position: { x: box.width / 2, y: box.height / 2 } },
    { x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 },
    onArrived,
  )
}

interface Scene { anchor: string; mover: string }

// Brings the scene's mover to a stop `aim` screen pixels short of the
// line it should align to, then runs `onArrived` with the pointer still
// down.
//
// It takes two gestures. React Flow begins a node drag only once the
// pointer has passed its own drag threshold, so a gesture's first move
// positions the grab rather than the card and the card always lands a
// fraction of the path short of where the pointer went. The first
// gesture parks the card just outside the threshold -- with ⌘ held, so
// nothing snaps and the parked position can simply be measured -- and
// the second covers the short remaining distance, over which that
// fraction is a pixel or two, comfortably inside the threshold the
// guide is being asked to notice.
async function approach(page: Page, scene: Scene, viaCentre: boolean, aim: number, holdMeta: boolean, onArrived: () => Promise<void>): Promise<void> {
  const anchorLeft = (await screenBox(cardWrapper(page, scene.anchor))).x
  const moverWidth = (await screenBox(cardWrapper(page, scene.mover))).width
  const restingLeft = viaCentre ? anchorLeft - moverWidth / 2 : anchorLeft

  await page.keyboard.down('Meta')
  try {
    // Repeated until the card really is parked: one gesture lands a
    // fraction of its own length short, and that fraction is only small
    // once the gesture itself is.
    for (let attempt = 0; attempt < 3; attempt++) {
      const left = (await screenBox(cardWrapper(page, scene.mover))).x
      const remaining = restingLeft + COARSE_GAP - left
      if (Math.abs(remaining) < 3) break
      await dragCardByPointer(page, scene.mover, remaining)
    }
  } finally {
    if (!holdMeta) await page.keyboard.up('Meta')
  }

  const parkedLeft = (await screenBox(cardWrapper(page, scene.mover))).x
  try {
    await dragCardByPointer(page, scene.mover, restingLeft + aim - parkedLeft, onArrived)
  } finally {
    if (holdMeta) await page.keyboard.up('Meta')
  }
}

// The board with one card to drag and one to align it against, both
// placed clear of the board's fixed chrome: the dragged one ends its
// travel wherever the alignment puts it, and a card resting under the
// zoom controls or the creation tray can no longer be right-clicked.
async function openScene(page: Page, anchor: string, mover: string): Promise<Scene> {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  const chrome = [page.getByTestId('rf__controls'), page.getByTestId('atlas-creation-tray')]
  const boardBox = await screenBox(board)
  await createCardViaTray(page, mover, { at: await emptySlot(page, board, chrome) })
  const moverBox = await screenBox(cardWrapper(page, mover))
  const moverID = await cardWrapper(page, mover).getAttribute('data-id')
  const chromeBoxes = await chromeRects(chrome)
  const occupied = [...await nodeRects(page), ...chromeBoxes]
  const spot = planAnchorSpot(boardBox, moverBox, verticalLines(await nodeRects(page, [moverID])), occupied, chromeBoxes, moverBox.y)
  await createCardViaTray(page, anchor, { at: spot })

  // Re-checked against the settled board: placing a card can shift what
  // was measured a moment ago.
  const anchorLeft = (await screenBox(cardWrapper(page, anchor))).x
  const others = await nodeRects(page, [await cardWrapper(page, anchor).getAttribute('data-id'), moverID])
  const lines = verticalLines(others)
  if (!columnIsClear(anchorLeft, moverBox.width, false, lines) || !columnIsClear(anchorLeft, moverBox.width, true, lines)) {
    throw new Error('the settled board left no clear approach to the anchor')
  }
  return { anchor, mover }
}

async function removeCards(page: Page, scene: Scene): Promise<void> {
  for (const title of [scene.mover, scene.anchor]) await deleteCardViaMenu(page, contextMenu(page), title)
}

test('a dragged card shows a vertical guide against a peer edge and drops exactly onto it', async ({ page }) => {
  const scene = await openScene(page, 'ZzGuideEdgeAnchor', 'ZzGuideEdgeMover')
  const anchorAt = await boardX(page, scene.anchor)

  await approach(page, scene, false, 0, false, async () => {
    const guide = page.locator(`${GUIDE}[data-axis="x"]`)
    await expect(guide).toBeVisible()
    expect(Math.abs((await screenBox(guide)).x - (await screenBox(cardWrapper(page, scene.anchor))).x)).toBeLessThan(2)
  })

  await expect(page.locator(GUIDE)).toHaveCount(0)
  // Exactly, not nearly: a raw pointer drop never lands on a whole
  // board coordinate, so this equality is the snap itself.
  await expect.poll(() => boardX(page, scene.mover)).toBeCloseTo(anchorAt, 5)

  await removeCards(page, scene)
})

test('a dragged card aligns by its centre, not only by its edges', async ({ page }) => {
  const scene = await openScene(page, 'ZzGuideCentreAnchor', 'ZzGuideCentreMover')

  await approach(page, scene, true, 0, false, async () => {
    await expect(page.locator(`${GUIDE}[data-axis="x"]`)).toBeVisible()
  })

  await expect(page.locator(GUIDE)).toHaveCount(0)
  // The dragged card's own CENTRE came to rest on the anchor's left edge.
  await expect
    .poll(async () => {
      const mover = await screenBox(cardWrapper(page, scene.mover))
      const anchor = await screenBox(cardWrapper(page, scene.anchor))
      return Math.abs(mover.x + mover.width / 2 - anchor.x)
    })
    .toBeLessThan(1.5)

  await removeCards(page, scene)
})

test('holding ⌘ suppresses both the guide and the snap', async ({ page }) => {
  const scene = await openScene(page, 'ZzGuideFreeAnchor', 'ZzGuideFreeMover')

  await approach(page, scene, false, CMD_GAP, true, async () => {
    await expect(page.locator(GUIDE)).toHaveCount(0)
  })

  await expect(page.locator(GUIDE)).toHaveCount(0)
  // The card kept the gap it was dropped at. A snap is the only thing
  // that makes these two coordinates equal, so any gap at all is the
  // proof -- and the card was aimed a few pixels short deliberately.
  await expect
    .poll(async () => Math.abs(await boardX(page, scene.mover) - await boardX(page, scene.anchor)))
    .toBeGreaterThan(1)

  await removeCards(page, scene)
})
