import { describe, expect, it } from 'vitest'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import {
  BOARD_GAP,
  GROUP_PREVIEW_SLOTS,
  NOTE_HEIGHT,
  NOTE_WIDTH,
  computeAutoArrangeLayout,
  computeGroupFrameLayout,
  isGroupCard,
} from './atlasBoardLayout'

function card(id: string, parentID: string, createdAt: string): Card {
  return { ID: id, ParentID: parentID, CreatedAt: createdAt } as Card
}

describe('isGroupCard', () => {
  it('is true exactly when the card has at least one child', () => {
    const all = [card('parent', '', '1'), card('leaf', '', '1'), card('child', 'parent', '2')]
    expect(isGroupCard(all, all[0])).toBe(true)
    expect(isGroupCard(all, all[1])).toBe(false)
  })
})

describe('computeGroupFrameLayout', () => {
  it('previews direct children one level deep: nested areas first as chips, then leaf notes', () => {
    const all = [
      card('group', '', '1'),
      card('a', 'group', '2'),
      card('b', 'group', '1'),
      card('grandchild', 'a', '1'),
    ]
    const layout = computeGroupFrameLayout(all, 'group')
    expect(layout.children.map((c) => c.card.ID)).toEqual(['a', 'b'])
    expect(layout.children.map((c) => c.variant)).toEqual(['chip', 'note'])
    expect(layout.children.every((c) => c.card.ID !== 'grandchild')).toBe(true)
    expect(layout.overflow).toBeNull()
  })

  it('caps the preview at GROUP_PREVIEW_SLOTS with a truthful overflow remainder', () => {
    const kids = Array.from({ length: 12 }, (_, i) => card(`k${String(i).padStart(2, '0')}`, 'group', '1'))
    const all = [card('group', '', '1'), ...kids]
    const layout = computeGroupFrameLayout(all, 'group')
    expect(layout.children).toHaveLength(GROUP_PREVIEW_SLOTS - 1)
    expect(layout.overflow?.count).toBe(12 - (GROUP_PREVIEW_SLOTS - 1))
    // Bounded: the frame never grows past the capped grid's rows.
    expect(layout.size.height).toBeLessThan(500)
  })

  it('renders exactly at the cap without a pointless "+ 1 more" ghost', () => {
    const kids = Array.from({ length: GROUP_PREVIEW_SLOTS }, (_, i) => card(`k${i}`, 'group', '1'))
    const all = [card('group', '', '1'), ...kids]
    const layout = computeGroupFrameLayout(all, 'group')
    expect(layout.children).toHaveLength(GROUP_PREVIEW_SLOTS)
    expect(layout.overflow).toBeNull()
  })

  it('sizes the frame to fit its own children in a wrapping grid', () => {
    const all = [card('group', '', '1'), ...['a', 'b', 'c', 'd'].map((id) => card(id, 'group', '1'))]
    const layout = computeGroupFrameLayout(all, 'group')
    // 4 children at 3 max columns -> 3 cols x 2 rows.
    expect(layout.size.width).toBe(12 * 2 + 3 * NOTE_WIDTH + 2 * BOARD_GAP)
    expect(layout.size.height).toBe(34 + 12 + 2 * NOTE_HEIGHT + BOARD_GAP)
  })

  it('returns an empty frame for a card with no children', () => {
    const all = [card('group', '', '1')]
    const layout = computeGroupFrameLayout(all, 'group')
    expect(layout.children).toEqual([])
    expect(layout.size.width).toBeGreaterThan(0)
  })
})

describe('computeAutoArrangeLayout', () => {
  it('places every card into a box with no positions carried over from input', () => {
    const all = [card('leaf', '', '1')]
    const layout = computeAutoArrangeLayout(all, all)
    const box = layout.boxes.get('leaf')
    expect(box).toEqual({ x: 0, y: 0, width: NOTE_WIDTH, height: NOTE_HEIGHT })
  })

  it('orders both region frames and leaf notes by CreatedAt then ID', () => {
    const topLevel = [
      card('leaf-b', '', '2026-01-02'),
      card('leaf-a', '', '2026-01-01'),
      card('group-b', '', '2026-01-02'),
      card('group-a', '', '2026-01-01'),
    ]
    const all = [
      ...topLevel,
      card('child-a', 'group-a', '2026-01-01'),
      card('child-b', 'group-b', '2026-01-01'),
    ]
    const layout = computeAutoArrangeLayout(topLevel, all)
    const byY = [...layout.boxes.entries()].sort((a, b) => a[1].y - b[1].y || a[1].x - b[1].x)
    const order = byY.map(([id]) => id)
    // With no adjacency, frames flow first (CreatedAt-ordered) then
    // leaves (CreatedAt-ordered) in one continuous wrap.
    expect(order.indexOf('group-a')).toBeLessThan(order.indexOf('group-b'))
    expect(order.indexOf('leaf-a')).toBeLessThan(order.indexOf('leaf-b'))
    expect(order.indexOf('group-b')).toBeLessThan(order.indexOf('leaf-a'))
  })

  it('link adjacency seats a linked leaf immediately after its frame instead of exiling it to the end', () => {
    const topLevel = [
      card('frame-a', '', '2026-01-01'),
      card('frame-b', '', '2026-01-02'),
      card('lonely-leaf', '', '2026-01-01'),
      card('linked-leaf', '', '2026-01-02'),
    ]
    const all = [
      ...topLevel,
      card('child-a', 'frame-a', '1'),
      card('child-b', 'frame-b', '1'),
    ]
    const adjacency = new Map([
      ['frame-a', ['linked-leaf']],
      ['linked-leaf', ['frame-a']],
    ])
    const layout = computeAutoArrangeLayout(topLevel, all, adjacency)
    const placementOrder = [...layout.boxes.keys()]
    // linked-leaf rides right behind frame-a -- ahead of frame-b and
    // the unlinked leaf despite its later CreatedAt.
    expect(placementOrder).toEqual(['frame-a', 'linked-leaf', 'frame-b', 'lonely-leaf'])
  })

  it('a wider row cap keeps more cards on one row; the constant stays the floor', () => {
    const all = Array.from({ length: 6 }, (_, i) => card(`leaf-${i}`, '', String(i)))
    const wide = computeAutoArrangeLayout(all, all, new Map(), 6 * NOTE_WIDTH + 5 * BOARD_GAP)
    expect(new Set([...wide.boxes.values()].map((b) => b.y)).size).toBe(1)
    // A cap below the four-note constant is floored, not honored.
    const floored = computeAutoArrangeLayout(all, all, new Map(), 100)
    expect(new Set([...floored.boxes.values()].map((b) => b.y)).size).toBe(2)
  })

  it('wraps a row once it would exceed the max row width', () => {
    const all = Array.from({ length: 6 }, (_, i) => card(`leaf-${i}`, '', String(i)))
    const layout = computeAutoArrangeLayout(all, all)
    const ys = new Set([...layout.boxes.values()].map((b) => b.y))
    // 4 cards fit per row at NOTE_WIDTH=190/gap=24 (BOARD_MAX_ROW_WIDTH),
    // so 6 leaves wrap onto a second row.
    expect(ys.size).toBe(2)
  })

  it('never persists or reads back a Position field -- pure from Card identity/CreatedAt alone', () => {
    const all = [card('leaf', '', '1')]
    const layoutA = computeAutoArrangeLayout(all, all)
    const layoutB = computeAutoArrangeLayout(all, all)
    expect(layoutA.boxes.get('leaf')).toEqual(layoutB.boxes.get('leaf'))
  })
})
