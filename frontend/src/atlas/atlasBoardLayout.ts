import type { BoardObject, Card, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { childrenOf } from './atlasGrouping'

// The one-map board's shared sizing (goal 0072 slice A): the DEFAULT
// note-card footprint, before a resize persists Card.Size (goal 0193)
// -- the group frame's own internal preview grid stays uniform at
// these two numbers regardless (computeGroupFrameLayout never reads a
// child's own Size), so a card's own resize never crosses into how it
// previews from one level up.
export const NOTE_WIDTH = 190
export const NOTE_HEIGHT = 128
export const BOARD_GAP = 24

// A sticky note's own footprint -- never fed into the shelves
// auto-arrange layout below: a note always renders at its own saved
// Position, in either board mode. STICKY_WIDTH is the default board
// width (a fresh note's own footprint until a resize persists
// Note.Size.W); STICKY_HEIGHT is a MINIMUM, not a fixed height -- the
// note's actual box height is content-driven (AtlasStickyNode.tsx),
// floored by this default or by a persisted Note.Size.H once resized.
// This constant also stands in as an estimate for pre-render layout
// math (atlasBoardBoxes.ts's own bounding-box computation), which runs
// before any real DOM measurement exists.
export const STICKY_WIDTH = 240
export const STICKY_HEIGHT = 110

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
  // Sticky notes filed in this frame, drawn in the same preview flow
  // (a filed note was invisible from one level up before this --
  // cards previewed, notes didn't).
  stickies: { note: Note; position: { x: number; y: number }; size: { width: number; height: number } }[]
  // Board objects filed in this frame, drawn in the same preview flow
  // (goal 0266's peer law -- before this, a drag-filed object was
  // simply invisible from one level up). Same real-face-in-a-slot
  // choice the stickies made, never a glyph chip.
  objects: { object: BoardObject; position: { x: number; y: number }; size: { width: number; height: number } }[]
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
export function computeGroupFrameLayout(allCards: Card[], groupID: string, allNotes: Note[], allObjects: BoardObject[]): GroupFrameLayout {
  const kids = childrenOf(allCards, groupID)
  const areas = stableSort(kids.filter((c) => isGroupCard(allCards, c, allNotes, allObjects)))
  const leaves = stableSort(kids.filter((c) => !isGroupCard(allCards, c, allNotes, allObjects)))
  const ordered = [...areas, ...leaves]
  const noteKids = allNotes.filter((n) => n.ParentID === groupID)
  const objectKids = [...allObjects.filter((o) => o.ParentID === groupID)].sort((a, b) => {
    const at = String(a.CreatedAt ?? '')
    const bt = String(b.CreatedAt ?? '')
    if (at !== bt) return at < bt ? -1 : 1
    if (a.ID === b.ID) return 0
    return a.ID < b.ID ? -1 : 1
  })

  // Cards, notes and objects share ONE preview budget; cards draw
  // first, then notes, then objects (goal 0266).
  const total = ordered.length + noteKids.length + objectKids.length
  const capped = total > GROUP_PREVIEW_SLOTS
  const budget = capped ? GROUP_PREVIEW_SLOTS - 1 : total
  const drawn = ordered.slice(0, budget)
  const drawnNotes = noteKids.slice(0, Math.max(0, budget - drawn.length))
  const drawnObjects = objectKids.slice(0, Math.max(0, budget - drawn.length - drawnNotes.length))
  const overflowCount = total - drawn.length - drawnNotes.length - drawnObjects.length

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
    const chip = isGroupCard(allCards, card, allNotes, allObjects)
    const size = chip ? { width: CHIP_WIDTH, height: CHIP_HEIGHT } : { width: NOTE_WIDTH, height: NOTE_HEIGHT }
    const pos = place(size.width, size.height)
    return {
      card,
      position: { x: GROUP_PADDING + pos.x, y: GROUP_HEADER_INSET + pos.y },
      size,
      variant: chip ? 'chip' : 'note',
    }
  })

  const stickies = drawnNotes.map((note) => {
    const size = { width: STICKY_WIDTH, height: STICKY_HEIGHT }
    const pos = place(size.width, size.height)
    return { note, position: { x: GROUP_PADDING + pos.x, y: GROUP_HEADER_INSET + pos.y }, size }
  })

  // Filed objects preview at the uniform note-slot size regardless of
  // their own Size (this function's header contract: the preview grid
  // never reads a child's own footprint).
  const objects = drawnObjects.map((object) => {
    const size = { width: NOTE_WIDTH, height: NOTE_HEIGHT }
    const pos = place(size.width, size.height)
    return { object, position: { x: GROUP_PADDING + pos.x, y: GROUP_HEADER_INSET + pos.y }, size }
  })

  let overflow: GroupFrameLayout['overflow'] = null
  if (overflowCount > 0) {
    const pos = place(NOTE_WIDTH, NOTE_HEIGHT)
    overflow = { count: overflowCount, position: { x: GROUP_PADDING + pos.x, y: GROUP_HEADER_INSET + pos.y } }
  }

  const empty = ordered.length === 0 && drawnNotes.length === 0 && drawnObjects.length === 0
  const contentWidth = empty ? NOTE_WIDTH : maxRight
  const contentHeight = empty ? NOTE_HEIGHT : cursorY + rowHeight
  const width = GROUP_PADDING * 2 + contentWidth
  const height = GROUP_HEADER_INSET + GROUP_PADDING + contentHeight
  return { size: { width, height }, children, stickies, objects, overflow }
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
// one child of ANY type: card, filed note, or filed board object --
// goal 0266's peer law), never a function of its own Kind (ADR-0038
// Decision 3: containment is a role, orthogonal to kind). All three
// child lists are REQUIRED so the render/layout/arrange/hit-box sites
// cannot silently disagree about frame-hood; a site passing [] is
// making a visible, commented cards-only choice.
export function isGroupCard(allCards: Card[], card: Card, allNotes: Note[], allObjects: BoardObject[]): boolean {
  return childrenOf(allCards, card.ID).length > 0
    || allNotes.some((n) => n.ParentID === card.ID)
    || allObjects.some((o) => o.ParentID === card.ID)
}

// linkAdjacentOrder is Auto-arrange's ordering pass (goal 0073, the
// owner's "auto arrange sucks" board): a layout blind to
// relationships strands a card in a leaves-band while its arteries
// point at frames a row away, forcing lines through frame bodies.
// Ordering instead walks the board's own link adjacency: anchors
// (frames first, then most-linked) each pull their not-yet-placed
// neighbors in right behind them, so related things sit beside each
// other and arteries land in the gaps. Deterministic: stable sort
// everywhere, adjacency from the caller's already-resolved edges.
function linkAdjacentOrder(cards: Card[], allCards: Card[], adjacency: Map<string, string[]>, allNotes: Note[], allObjects: BoardObject[]): Card[] {
  const frames = stableSort(cards.filter((c) => isGroupCard(allCards, c, allNotes, allObjects)))
  const leaves = stableSort(cards.filter((c) => !isGroupCard(allCards, c, allNotes, allObjects)))
  const byID = new Map(cards.map((c) => [c.ID, c]))
  const out: Card[] = []
  const placed = new Set<string>()

  const emit = (card: Card | undefined) => {
    if (!card || placed.has(card.ID)) return
    placed.add(card.ID)
    out.push(card)
    for (const nID of adjacency.get(card.ID) ?? []) emit(byID.get(nID))
  }

  for (const f of frames) emit(f)
  for (const l of leaves) emit(l)
  return out
}

// ArrangeObjectTile: a board object's footprint as the packer sees it
// -- the caller resolves the size (persisted Size, measured AABB, or a
// fallback) since this pure layout has no access to rendered
// measurements. Objects pack AFTER cards, in creation order: they have
// no link adjacency to order by, and cards-first keeps every existing
// card-only layout byte-identical.
export interface ArrangeObjectTile {
  id: string
  width: number
  height: number
  createdAt: string
}

// computeAutoArrangeLayout is Auto-arrange mode's own deterministic
// placement: link-adjacent order (above) flowed into wrapping rows of
// mixed sizes. The row cap follows the real board width when the
// caller knows it (dead right-hand columns read as broken), floored
// at the four-note constant so a narrow pane still wraps sanely.
// Nothing here is persisted; the caller never calls SetPosition off
// these boxes.
export function computeAutoArrangeLayout(
  cards: Card[],
  allCards: Card[],
  adjacency: Map<string, string[]> = new Map(),
  maxRowWidth: number = BOARD_MAX_ROW_WIDTH,
  allNotes: Note[] = [],
  objectTiles: ArrangeObjectTile[] = [],
  // Distinct from objectTiles above: tiles are THIS level's own
  // objects to pack; allObjects feeds the frame-role/frame-size
  // derivation for FILED objects inside the frames being packed.
  allObjects: BoardObject[] = [],
): BoardLayout {
  const rowCap = Math.max(BOARD_MAX_ROW_WIDTH, maxRowWidth)
  const ordered = linkAdjacentOrder(cards, allCards, adjacency, allNotes, allObjects)
  const boxes = new Map<string, BoardBox>()

  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0
  const place = (id: string, width: number, height: number) => {
    if (cursorX > 0 && cursorX + width > rowCap) {
      cursorX = 0
      cursorY += rowHeight + BOARD_GAP
      rowHeight = 0
    }
    boxes.set(id, { x: cursorX, y: cursorY, width, height })
    cursorX += width + BOARD_GAP
    rowHeight = Math.max(rowHeight, height)
  }

  for (const card of ordered) {
    if (isGroupCard(allCards, card, allNotes, allObjects)) {
      const { size } = computeGroupFrameLayout(allCards, card.ID, allNotes, allObjects)
      place(card.ID, size.width, size.height)
    } else if (card.ProjectionListID) {
      // A table projection packs at its real rendered footprint --
      // note-sized packing would overlap its neighbors (goal 0105).
      place(card.ID, card.Size?.W ?? TABLE_WIDTH, card.Size?.H ?? TABLE_HEIGHT)
    } else {
      // Same real-footprint packing as the table branch above (goal
      // 0193): a resized note-card must not overlap its neighbors
      // either.
      place(card.ID, card.Size?.W ?? NOTE_WIDTH, card.Size?.H ?? NOTE_HEIGHT)
    }
  }

  const tiles = [...objectTiles].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
    if (a.id === b.id) return 0
    return a.id < b.id ? -1 : 1
  })
  for (const tile of tiles) place(tile.id, tile.width, tile.height)

  return { boxes }
}

// The List → table projection's Free-mode footprint (goal 0105): wide
// enough for a few real columns, tall enough for ~6 rows before the
// inner scroll takes over.
export const TABLE_WIDTH = 520
export const TABLE_HEIGHT = 320

// A board object's footprint guess when neither a persisted Size nor a
// live measurement is at hand: the natural-size CSS clamp's own ceiling
// (AtlasBoardObjectNode.module.css caps unresized content at 480px per
// axis). Deliberately conservative -- it only ever pads WHERE fresh
// position-less cards seat and where an unmeasured object packs, and an
// over-guess costs a gap while an under-guess costs an overlap.
export const OBJECT_FALLBACK_EXTENT = 480
