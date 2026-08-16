import { describe, expect, it } from 'vitest'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import {
  BOARD_GAP,
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
  it('positions every direct child inside the frame, one nesting level deep', () => {
    const all = [
      card('group', '', '1'),
      card('a', 'group', '2'),
      card('b', 'group', '1'),
      card('grandchild', 'a', '1'),
    ]
    const layout = computeGroupFrameLayout(all, 'group')
    expect(layout.children.map((c) => c.card.ID)).toEqual(['b', 'a'])
    expect(layout.children.every((c) => c.card.ID !== 'grandchild')).toBe(true)
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
    // Groups (group-a before group-b, both CreatedAt-ordered) occupy
    // the first row; leaves (leaf-a before leaf-b) start a fresh row
    // below them.
    expect(order.indexOf('group-a')).toBeLessThan(order.indexOf('group-b'))
    expect(order.indexOf('leaf-a')).toBeLessThan(order.indexOf('leaf-b'))
    expect(order.indexOf('group-b')).toBeLessThan(order.indexOf('leaf-a'))
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
