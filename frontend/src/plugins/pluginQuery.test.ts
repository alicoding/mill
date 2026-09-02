import { describe, expect, it } from 'vitest'
import type { ContentEntry as WireEntry } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { contentEntryFromWire } from './pluginQuery'

describe('contentEntryFromWire', () => {
  it('restates the Go envelope in the SDK shape, dropping empty optionals', () => {
    const wire = {
      ID: 'n1', Kind: 'note', Subkind: '', Title: 'Plan', ParentID: '',
      Position: { X: 1, Y: 2 }, Size: null, Payload: { text: 'Plan\nbody' },
    } as unknown as WireEntry
    expect(contentEntryFromWire(wire)).toEqual({
      id: 'n1', kind: 'note', subkind: undefined, title: 'Plan', parentId: undefined,
      position: { x: 1, y: 2 }, size: undefined, payload: { text: 'Plan\nbody' },
    })
  })

  it('keeps a card\'s subkind, parent, and size when present', () => {
    const wire = {
      ID: 'c1', Kind: 'card', Subkind: 'kind-topic', Title: 'Root', ParentID: 'p',
      Position: { X: 0, Y: 0 }, Size: { W: 3, H: 4 }, Payload: null,
    } as unknown as WireEntry
    expect(contentEntryFromWire(wire)).toMatchObject({ subkind: 'kind-topic', parentId: 'p', size: { w: 3, h: 4 }, payload: {} })
  })
})
