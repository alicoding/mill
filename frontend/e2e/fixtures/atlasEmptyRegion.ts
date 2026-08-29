import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { waitForViewportStable } from './animation'

// Content-agnostic replacement for a hand-picked viewport fraction
// (goal 0223's own class: adding one seeded card to the landing board
// shifted fitView's settled zoom/pan, which silently moved several
// fixed-viewport-fraction draw/click points onto real content --
// atlas-shape-tool.spec.ts and atlas-single-space-trap.spec.ts both hit
// it). Every point below is derived from what's ACTUALLY rendered at
// call time, so it stays correct regardless of how much seeded content
// the landing board carries in the future.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// Exported for atlas-single-space-trap.spec.ts's own overlap assertion
// (goal 0233): the same rectangle-intersection test findEmptyBoardRect
// already relies on internally, reused rather than a second copy.
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

async function occupiedRectsOnce(page: Page, avoid: Locator[]): Promise<Rect[]> {
  const rects: Rect[] = []
  const nodes = page.locator('.react-flow__node')
  const count = await nodes.count()
  for (let i = 0; i < count; i++) {
    const box = await nodes.nth(i).boundingBox()
    if (box) rects.push(box)
  }
  for (const loc of avoid) {
    // Chrome that isn't a react-flow node (a style picker popover, the
    // creation tray) still occludes a drag/click's start point (goal
    // 0184's own "verify reachable, don't assume" class) -- skipped
    // gracefully when the caller's own chrome isn't currently mounted.
    if (await loc.isVisible().catch(() => false)) {
      const box = await loc.boundingBox()
      if (box) rects.push(box)
    }
  }
  return rects
}

// A group/frame card's own footprint (computeGroupFrameLayout,
// atlasBoardLayout.ts) is computed by a React effect AFTER its first
// paint, not in the same pass React Flow's viewport transform settles
// in -- waitForViewportStable alone can still catch a card's own node
// at its smaller pre-layout box. Polls occupiedRectsOnce for two
// consecutive IDENTICAL reads (same class of race, same fix shape as
// waitForViewportStable, applied to node geometry instead of the
// viewport transform) before trusting it -- a scan taken mid-layout is
// exactly how an "empty" pick landed on a card that had since grown
// underneath it.
async function occupiedRects(page: Page, avoid: Locator[]): Promise<Rect[]> {
  let previous: string | null = null
  let stable: Rect[] = []
  await expect
    .poll(async () => {
      const rects = await occupiedRectsOnce(page, avoid)
      const serialized = JSON.stringify(rects)
      const isStable = previous !== null && serialized === previous
      previous = serialized
      stable = rects
      return isStable
    }, { timeout: 5_000 })
    .toBe(true)
  return stable
}

// findEmptyBoardRect scans a coarse grid of candidate top-left corners
// inside the board's own visible box for one whose full width x height
// box clears every currently-rendered node (and any extra chrome in
// `avoid`) -- preferring the top of the viewport first, so a caller
// that doesn't care where the rect lands still gets a stable, low-y
// pick run to run. Throws rather than silently returning an occupied
// point: a caller landing on real content is a false pass waiting to
// happen, not a recoverable state.
export async function findEmptyBoardRect(page: Page, board: Locator, width: number, height: number, avoid: Locator[] = []): Promise<{ x: number; y: number }> {
  // React Flow's own fitView/pan animates the viewport's transform via
  // d3-zoom's JS interpolation, not a CSS transition (fixtures/
  // animation.ts's own header) -- a node bounding box read while it's
  // still mid-flight is stale by the time the caller actually clicks,
  // which is exactly how an "empty" pick landed on a card that had
  // since settled elsewhere.
  await waitForViewportStable(board)
  const boardBox = await board.boundingBox()
  if (!boardBox) throw new Error('findEmptyBoardRect: board has no bounding box')
  const occupied = await occupiedRects(page, avoid)
  const stepX = Math.max(40, width / 3)
  const stepY = Math.max(40, height / 3)
  for (let y = boardBox.y; y + height <= boardBox.y + boardBox.height; y += stepY) {
    for (let x = boardBox.x; x + width <= boardBox.x + boardBox.width; x += stepX) {
      const candidate = { x, y, width, height }
      if (!occupied.some((r) => rectsOverlap(candidate, r))) return { x, y }
    }
  }
  throw new Error('findEmptyBoardRect: no empty region found on the visible board')
}

// findEmptyBoardPoint is findEmptyBoardRect's degenerate case for a
// caller that only needs one clear pixel (a right-click target), not a
// drag-sized rectangle -- atlas-single-space-trap.spec.ts's own use.
export async function findEmptyBoardPoint(page: Page, board: Locator, avoid: Locator[] = []): Promise<{ x: number; y: number }> {
  return findEmptyBoardRect(page, board, 12, 12, avoid)
}

// Places a fresh draft note (the N tool) in a region findEmptyBoardRect
// proves clear of every rendered node, with margin for the caller's own
// later pointer work: at the note's default-width footprint a corner
// placement crowds the seeded cards, and later clicks/drags on the note
// or its handles hit-test a neighboring card's surface instead --
// order-dependently, since the restored session level shifts what
// fitView shows. Promoted per the 2+-spec-files fixture rule.
export async function placeNoteClear(page: Page, board: Locator): Promise<void> {
  await page.keyboard.press('n')
  const spot = await findEmptyBoardRect(page, board, 300, 200)
  const boardBox = await board.boundingBox()
  if (!boardBox) throw new Error('placeNoteClear: board has no bounding box')
  await board.click({ position: { x: spot.x - boardBox.x + 10, y: spot.y - boardBox.y + 10 } })
}
