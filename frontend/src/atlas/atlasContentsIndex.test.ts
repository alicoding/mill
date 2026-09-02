import { describe, expect, it } from 'vitest'
import type { ContentEntry } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
// The registry self-registers on this import (atlasTools.ts's glob), as
// every registry-reading test loads it.
import './atlasTools'
import { groupContents } from './atlasContentsIndex'

const entry = (id: string, kind: string, title: string): ContentEntry =>
  ({ ID: id, Kind: kind, Subkind: '', Title: title, ParentID: '', Position: { X: 0, Y: 0 }, Size: null, Payload: null }) as unknown as ContentEntry

describe('groupContents', () => {
  const entries = [
    entry('o1', 'image', 'Reference'),
    entry('n2', 'note', 'zeta'),
    entry('c1', 'card', 'The engagement'),
    entry('n1', 'note', 'Alpha plan'),
    entry('x1', 'someplugin-kind', 'Plugin thing'),
  ]

  it('groups cards, then notes, then object kinds, titles ascending, unknown kinds last with a title-cased label', () => {
    const groups = groupContents(entries, '')
    expect(groups.map((g) => g.kind)).toEqual(['card', 'note', 'image', 'someplugin-kind'])
    expect(groups[1].entries.map((e) => e.Title)).toEqual(['Alpha plan', 'zeta'])
    expect(groups[3].label).toBe('Someplugin kind')
    expect(groups[0].label).toBe('Card')
  })

  it('filters by title, case-insensitively, and omits emptied groups', () => {
    const groups = groupContents(entries, '  PLAN ')
    expect(groups.map((g) => g.kind)).toEqual(['note'])
    expect(groups[0].entries.map((e) => e.ID)).toEqual(['n1'])
    expect(groupContents(entries, 'nothing here')).toEqual([])
  })
})
