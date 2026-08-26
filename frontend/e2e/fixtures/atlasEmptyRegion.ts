import type { Locator, Page } from '@playwright/test'

// Content-agnostic replacement for a hand-picked viewport fraction
// (goal 0223's own class: adding one seeded card to the landing board
// shifted fitView's settled zoom/pan, which silently moved several
// fixed-viewport-fraction draw/click points onto real content --
// atlas-shape-tool.spec.ts and atlas-single-space-trap.spec.ts both hit
// it). Every point below is derived from what's ACTUALLY rendered at
// call time, so it stays correct regardless of how much seeded content
// the landing board carries in the future.

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

async function occupiedRects(page: Page, avoid: Locator[]): Promise<Rect[]> {
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

// findEmptyBoardRect scans a coarse grid of candidate top-left corners
// inside the board's own visible box for one whose full width x height
// box clears every currently-rendered node (and any extra chrome in
// `avoid`) -- preferring the top of the viewport first, so a caller
// that doesn't care where the rect lands still gets a stable, low-y
// pick run to run. Throws rather than silently returning an occupied
// point: a caller landing on real content is a false pass waiting to
// happen, not a recoverable state.
export async function findEmptyBoardRect(page: Page, board: Locator, width: number, height: number, avoid: Locator[] = []): Promise<{ x: number; y: number }> {
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
