import { describe, expect, it } from 'vitest'
import { resolveDefaultKindID, titleFromNoteText } from './atlasCreateHelpers'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

function kind(id: string): Kind {
  return { ID: id, Label: id, Description: '', Icon: '', Fields: [], LinkKindIDs: [] } as unknown as Kind
}

describe('resolveDefaultKindID', () => {
  it('picks the last-used kind when it still exists', () => {
    const kinds = [kind('a'), kind('b')]
    expect(resolveDefaultKindID(kinds, 'b')).toBe('b')
  })

  it('falls back to the first kind when the last-used one is gone', () => {
    const kinds = [kind('a'), kind('b')]
    expect(resolveDefaultKindID(kinds, 'deleted')).toBe('a')
  })

  it('falls back to the first kind when nothing was ever used', () => {
    const kinds = [kind('a'), kind('b')]
    expect(resolveDefaultKindID(kinds, null)).toBe('a')
  })

  it('returns an empty string when no kinds are declared', () => {
    expect(resolveDefaultKindID([], 'a')).toBe('')
  })
})

describe('titleFromNoteText', () => {
  it('takes only the first line, trimmed', () => {
    expect(titleFromNoteText('  first line  \nsecond line')).toBe('first line')
  })

  it('passes short single-line text through unchanged', () => {
    expect(titleFromNoteText('a short note')).toBe('a short note')
  })

  it('caps at 80 characters with an ellipsis', () => {
    const long = 'x'.repeat(120)
    const got = titleFromNoteText(long)
    expect(got).toHaveLength(80)
    expect(got.endsWith('…')).toBe(true)
    expect(got.startsWith('x'.repeat(79))).toBe(true)
  })
})
