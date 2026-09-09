import { describe, expect, it } from 'vitest'
import { KeyIcon } from '@primer/octicons-react'
import { groupOrder, listRuns, type InventoryItem, type InventoryItemGroup } from './inventoryItem'

// The merged Secrets list's own ordering (goal 0408 S2): vault entries
// (no `group`) first, then one bucket per source, alphabetical by the
// source's own label -- pure so the shape is pinned without mounting
// InventoryList.

const icon = { Icon: KeyIcon, bg: '#000', fg: '#fff' }

function group(key: string, label: string): InventoryItemGroup {
  return { key, label, icon }
}

function item(id: string, label: string, groupOf?: InventoryItemGroup): InventoryItem {
  return { id, entity: 'secret', icon, label, onOpen: () => undefined, menuActions: [], group: groupOf }
}

describe('groupOrder', () => {
  it('puts every ungrouped item first, in its incoming order', () => {
    const items = [
      item('a', 'A Vault Entry'),
      item('b', 'B Source Key', group('src-2', 'Zeta source')),
      item('c', 'C Vault Entry'),
    ]
    expect(groupOrder(items).map((i) => i.id)).toEqual(['a', 'c', 'b'])
  })

  it('orders source buckets alphabetically by the group label, not by first appearance', () => {
    const items = [
      item('z', 'Key in Zeta', group('src-z', 'Zeta source')),
      item('a', 'Key in Alpha', group('src-a', 'Alpha source')),
    ]
    expect(groupOrder(items).map((i) => i.id)).toEqual(['a', 'z'])
  })

  it('keeps each bucket stable relative to the incoming (already-sorted) order', () => {
    const items = [
      item('a2', 'second', group('src-a', 'Alpha')),
      item('a1', 'first', group('src-a', 'Alpha')),
    ]
    expect(groupOrder(items).map((i) => i.id)).toEqual(['a2', 'a1'])
  })
})

describe('listRuns', () => {
  it('collapses an all-ungrouped list into exactly one run with no header', () => {
    const items = [item('a', 'A'), item('b', 'B')]
    const runs = listRuns(items)
    expect(runs).toHaveLength(1)
    expect(runs[0].group).toBeUndefined()
    expect(runs[0].items.map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('splits into one run per contiguous group, vault first', () => {
    const alpha = group('src-a', 'Alpha source')
    const items = groupOrder([
      item('v1', 'Vault one'),
      item('k1', 'Key one', alpha),
      item('k2', 'Key two', alpha),
    ])
    const runs = listRuns(items)
    expect(runs.map((r) => r.group?.key)).toEqual([undefined, 'src-a'])
    expect(runs[0].items.map((i) => i.id)).toEqual(['v1'])
    expect(runs[1].items.map((i) => i.id)).toEqual(['k1', 'k2'])
  })

  it('re-opens a header for a group split across two calls (a page boundary continuation)', () => {
    const alpha = group('src-a', 'Alpha source')
    const page2 = [item('k3', 'Key three', alpha)]
    expect(listRuns(page2)[0].group?.key).toBe('src-a')
  })
})
