import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { childrenOf } from './atlasGrouping'

// The one-map board's shared sizing (goal 0072 slice A): every note
// card renders at this fixed footprint regardless of view mode, and
// every layout below (the group frame's own internal preview grid,
// Auto-arrange's top-level flow) is built from the same two numbers so
// a card never resizes crossing between a group's preview and its own
// focused board.
export const NOTE_WIDTH = 190
export const NOTE_HEIGHT = 128
export const BOARD_GAP = 24

// A region frame's own chrome: vertical space reserved above its
// preview grid for the header row, and the padding around the grid on
// every other side.
export const GROUP_HEADER_INSET = 34
export const GROUP_PADDING = 12
const GROUP_MAX_COLUMNS = 3

// Auto-arrange wraps a row once it would exceed roughly four note
// cards' width -- wide enough that a handful of region frames and
// leaf notes share a row before wrapping, narrow enough that a board
// with only a few cards doesn't stretch into one long unreadable line.
const BOARD_MAX_ROW_WIDTH = 4 * NOTE_WIDTH + 3 * BOARD_GAP

function stableSort(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const at = String(a.CreatedAt ?? '')
    const bt = String(b.CreatedAt ?? '')
    if (at !== bt) return at < bt ? -1 : 1
    if (a.ID === b.ID) return 0
    return a.ID < b.ID ? -1 : 1
  })
}

function gridPositions(count: number, maxColumns: number): { x: number; y: number }[] {
  const cols = Math.max(1, Math.min(maxColumns, count))
  const out: { x: number; y: number }[] = []
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols)
    const col = i % cols
    out.push({ x: col * (NOTE_WIDTH + BOARD_GAP), y: row * (NOTE_HEIGHT + BOARD_GAP) })
  }
  return out
}

export interface GroupFrameLayout {
  size: { width: number; height: number }
  children: { card: Card; position: { x: number; y: number } }[]
}

// computeGroupFrameLayout sizes a region frame and positions its own
// direct children inside it, one nesting level deep (grandchildren are
// never part of this layout -- a nested card that itself has children
// renders as a plain note card here, its own `N` count carried by the
// note's own presence chip). This preview grid is never draggable and
// never persisted, in EITHER board mode -- Free mode's saved positions
// only ever govern a card's place on its OWN focused board, not this
// read-only preview of its children from one level up.
export function computeGroupFrameLayout(allCards: Card[], groupID: string): GroupFrameLayout {
  const kids = stableSort(childrenOf(allCards, groupID))
  const cols = Math.max(1, Math.min(GROUP_MAX_COLUMNS, kids.length))
  const rows = kids.length === 0 ? 1 : Math.ceil(kids.length / cols)
  const positions = gridPositions(kids.length, GROUP_MAX_COLUMNS)
  const children = kids.map((card, i) => ({
    card,
    position: { x: GROUP_PADDING + positions[i].x, y: GROUP_HEADER_INSET + positions[i].y },
  }))
  const width = GROUP_PADDING * 2 + cols * NOTE_WIDTH + (cols - 1) * BOARD_GAP
  const height = GROUP_HEADER_INSET + GROUP_PADDING + rows * NOTE_HEIGHT + (rows - 1) * BOARD_GAP
  return { size: { width, height }, children }
}

export interface BoardBox {
  x: number
  y: number
  width: number
  height: number
}

export interface BoardLayout {
  boxes: Map<string, BoardBox>
}

// isGroupCard reports whether card renders as a region frame on the
// currently focused board -- purely structural (does it have at least
// one child among allCards), never a function of its own Kind
// (ADR-0038 Decision 3: containment is a role, orthogonal to kind).
export function isGroupCard(allCards: Card[], card: Card): boolean {
  return childrenOf(allCards, card.ID).length > 0
}

// computeAutoArrangeLayout is Auto-arrange mode's own deterministic
// placement (goal 0072 slice A): region frames first, left to right
// then wrapping, then leaf notes in rows below -- both buckets ordered
// by CreatedAt then ID so the same input always produces the same
// layout. Nothing here is persisted; the caller never calls
// SetPosition off these boxes.
export function computeAutoArrangeLayout(cards: Card[], allCards: Card[]): BoardLayout {
  const groups = stableSort(cards.filter((c) => isGroupCard(allCards, c)))
  const leaves = stableSort(cards.filter((c) => !isGroupCard(allCards, c)))
  const boxes = new Map<string, BoardBox>()

  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0
  const place = (id: string, width: number, height: number) => {
    if (cursorX > 0 && cursorX + width > BOARD_MAX_ROW_WIDTH) {
      cursorX = 0
      cursorY += rowHeight + BOARD_GAP
      rowHeight = 0
    }
    boxes.set(id, { x: cursorX, y: cursorY, width, height })
    cursorX += width + BOARD_GAP
    rowHeight = Math.max(rowHeight, height)
  }

  for (const g of groups) {
    const { size } = computeGroupFrameLayout(allCards, g.ID)
    place(g.ID, size.width, size.height)
  }
  if (groups.length > 0 && leaves.length > 0) {
    cursorX = 0
    cursorY += rowHeight + BOARD_GAP
    rowHeight = 0
  }
  for (const l of leaves) {
    place(l.ID, NOTE_WIDTH, NOTE_HEIGHT)
  }

  return { boxes }
}
