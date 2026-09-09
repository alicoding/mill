import { describe, expect, it } from 'vitest'
import { materializeExamplePayload } from './atlasThirdPartyPlacement'
import type { CanvasObjectExample } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'

const EXAMPLE: CanvasObjectExample = {
  title: 'Mind map example',
  payload: {},
  revision: 1,
  fixtures: [{ kind: 'note', title: 'Mind map example', body: '# Mind map example', payloadKey: 'noteId' }],
}

describe('materializeExamplePayload', () => {
  it('fills an empty payload with the declared example, title, and each fixture id at its payloadKey', () => {
    const merged = materializeExamplePayload({}, EXAMPLE, ['atlas-note-example-1'])
    expect(merged).toEqual({ title: 'Mind map example', noteId: 'atlas-note-example-1' })
  })

  it('leaves a non-empty starting payload untouched -- paste, duplicate, and agent inserts', () => {
    const starting = { noteId: 'user-note-1' }
    expect(materializeExamplePayload(starting, EXAMPLE, ['atlas-note-example-1'])).toBe(starting)
  })

  it('leaves an empty payload untouched when the kind declares no example', () => {
    const starting = {}
    expect(materializeExamplePayload(starting, null, [])).toBe(starting)
  })

  it('merges the example\'s own declared payload keys ahead of the fixture ids', () => {
    const withPayload: CanvasObjectExample = { ...EXAMPLE, payload: { seed: 'true' } }
    const merged = materializeExamplePayload({}, withPayload, ['note-1'])
    expect(merged).toEqual({ seed: 'true', title: 'Mind map example', noteId: 'note-1' })
  })
})
