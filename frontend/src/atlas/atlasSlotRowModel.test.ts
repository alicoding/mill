import { describe, expect, it } from 'vitest'
import type { Card, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { buildSlotRows } from './atlasSlotRowModel'

function card(id: string, title = id): Card {
  return { ID: id, Title: title } as Card
}
function link(id: string, from: string, to: string, kind: string): Link {
  return { ID: id, FromCardID: from, ToCardID: to, LinkKindID: kind } as Link
}
function linkKind(id: string, label: string): LinkKind {
  return { ID: id, Label: label } as LinkKind
}

describe('buildSlotRows', () => {
  it('emits one row per link kind, in the given order when none carry links', () => {
    const self = card('self')
    const rows = buildSlotRows(self, [self], [], [linkKind('lk-relates', 'relates to'), linkKind('lk-depends', 'depends on')])
    expect(rows.map((r) => r.linkKindID)).toEqual(['lk-relates', 'lk-depends'])
  })

  it('resolves chips in either direction, prefixed by direction', () => {
    const self = card('self')
    const other1 = card('other1', 'Other One')
    const other2 = card('other2', 'Other Two')
    const rows = buildSlotRows(
      self,
      [self, other1, other2],
      [link('l1', self.ID, other1.ID, 'lk-relates'), link('l2', other2.ID, self.ID, 'lk-relates')],
      [linkKind('lk-relates', 'relates to')],
    )
    const chips = rows[0].chips
    expect(chips).toHaveLength(2)
    expect(chips.find((c) => c.cardID === 'other1')).toMatchObject({ direction: 'out', title: 'Other One' })
    expect(chips.find((c) => c.cardID === 'other2')).toMatchObject({ direction: 'in', title: 'Other Two' })
  })

  it('sorts rows with links before empty rows, keeping relates-to first among equals', () => {
    const self = card('self')
    const other = card('other')
    // 'lk-depends' is declared FIRST but carries no link; 'lk-relates'
    // is declared second but carries one -- links-first must still put
    // it ahead despite its later declaration order.
    const rows = buildSlotRows(
      self,
      [self, other],
      [link('l1', self.ID, other.ID, 'lk-relates')],
      [linkKind('lk-depends', 'depends on'), linkKind('lk-relates', 'relates to'), linkKind('lk-owns', 'owned by')],
    )
    expect(rows.map((r) => r.linkKindID)).toEqual(['lk-relates', 'lk-depends', 'lk-owns'])
  })

  it('keeps the generic relates-to kind first among two empty rows when it is declared first', () => {
    const self = card('self')
    const rows = buildSlotRows(self, [self], [], [linkKind('lk-relates', 'relates to'), linkKind('lk-depends', 'depends on')])
    expect(rows[0].linkKindID).toBe('lk-relates')
  })

  it('ignores a link naming a card that no longer exists', () => {
    const self = card('self')
    const rows = buildSlotRows(self, [self], [link('l1', self.ID, 'ghost', 'lk-relates')], [linkKind('lk-relates', 'relates to')])
    expect(rows[0].chips).toHaveLength(0)
  })
})
