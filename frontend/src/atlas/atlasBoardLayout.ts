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

// Semantic zoom (goal 0073): a frame previews at most this many slots
// -- presence and health at distance, exhaustive content only after
// zooming in. Past the cap, the last slot is a "+ K more" ghost tile
// and the frame stops growing; the header count and freshness pills
// still roll up EVERY child regardless of what's drawn.
export const GROUP_PREVIEW_SLOTS = 6

// A nested area inside a frame renders as a compact region chip (a
// place within a place), not a full note card.
export const CHIP_WIDTH = 150
export const CHIP_HEIGHT = 64

const GROUP_MAX_ROW_WIDTH = 3 * NOTE_WIDTH + 2 * BOARD_GAP

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

export interface GroupFrameChild {
  card: Card
  position: { x: number; y: number }
  size: { width: number; height: number }
  variant: 'note' | 'chip'
}

export interface GroupFrameLayout {
  size: { width: number; height: number }
  children: GroupFrameChild[]
  // Set when the preview cap truncated the children: how many are NOT
  // drawn, and where the "+ K more" ghost tile sits (a note-sized slot).
  overflow: { count: number; position: { x: number; y: number } } | null
}

// computeGroupFrameLayout sizes a region frame and positions a capped
// preview of its own direct children inside it (semantic zoom, goal
// 0073): nested areas first as compact region chips, then leaf notes,
// row-flowed with mixed sizes; past GROUP_PREVIEW_SLOTS the last slot
// becomes a "+ K more" ghost tile and the frame stops growing.
// Grandchildren are never part of this layout -- each chip's own `N`
// count carries them. This preview grid is never draggable and never
// persisted, in EITHER board mode -- Free mode's saved positions only
// ever govern a card's place on its OWN focused board, not this
// read-only preview of its children from one level up.
export function computeGroupFrameLayout(allCards: Card[], groupID: string): GroupFrameLayout {
  const kids = childrenOf(allCards, groupID)
  const areas = stableSort(kids.filter((c) => isGroupCard(allCards, c)))
  const leaves = stableSort(kids.filter((c) => !isGroupCard(allCards, c)))
  const ordered = [...areas, ...leaves]

  const capped = ordered.length > GROUP_PREVIEW_SLOTS
  const drawn = capped ? ordered.slice(0, GROUP_PREVIEW_SLOTS - 1) : ordered
  const overflowCount = ordered.length - drawn.length

  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0
  let maxRight = 0
  const place = (width: number, height: number): { x: number; y: number } => {
    if (cursorX > 0 && cursorX + width > GROUP_MAX_ROW_WIDTH) {
      cursorX = 0
      cursorY += rowHeight + BOARD_GAP
      rowHeight = 0
    }
    const pos = { x: cursorX, y: cursorY }
    cursorX += width + BOARD_GAP
    rowHeight = Math.max(rowHeight, height)
    maxRight = Math.max(maxRight, pos.x + width)
    return pos
  }

  const children: GroupFrameChild[] = drawn.map((card) => {
    const chip = isGroupCard(allCards, card)
    const size = chip ? { width: CHIP_WIDTH, height: CHIP_HEIGHT } : { width: NOTE_WIDTH, height: NOTE_HEIGHT }
    const pos = place(size.width, size.height)
    return {
      card,
      position: { x: GROUP_PADDING + pos.x, y: GROUP_HEADER_INSET + pos.y },
      size,
      variant: chip ? 'chip' : 'note',
    }
  })

  let overflow: GroupFrameLayout['overflow'] = null
  if (overflowCount > 0) {
    const pos = place(NOTE_WIDTH, NOTE_HEIGHT)
    overflow = { count: overflowCount, position: { x: GROUP_PADDING + pos.x, y: GROUP_HEADER_INSET + pos.y } }
  }

  const contentWidth = ordered.length === 0 ? NOTE_WIDTH : maxRight
  const contentHeight = ordered.length === 0 ? NOTE_HEIGHT : cursorY + rowHeight
  const width = GROUP_PADDING * 2 + contentWidth
  const height = GROUP_HEADER_INSET + GROUP_PADDING + contentHeight
  return { size: { width, height }, children, overflow }
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
