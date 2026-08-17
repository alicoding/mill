import { describe, expect, it } from 'vitest'
import { resolveDefaultKindID, titleFromFilename, titleFromNoteText } from './atlasCreateHelpers'
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

  // The same function doubles as the paste door's own first-line-title
  // derivation (goal 0081 slice A3) -- these cases exercise it against
  // realistic pasted-text shapes rather than a note's own body.
  it('takes only the first line of pasted multi-paragraph text', () => {
    const pasted = 'Q3 migration checklist\n\n- item one\n- item two'
    expect(titleFromNoteText(pasted)).toBe('Q3 migration checklist')
  })

  it('trims leading/trailing whitespace on a pasted single line', () => {
    expect(titleFromNoteText('   pasted from a chat app   ')).toBe('pasted from a chat app')
  })
})

describe('titleFromFilename', () => {
  it('strips the extension', () => {
    expect(titleFromFilename('meeting_notes-v2.md')).toBe('meeting_notes-v2')
  })

  it('strips the directory and the extension', () => {
    expect(titleFromFilename('/Users/me/Downloads/Project Plan.docx')).toBe('Project Plan')
  })

  it('handles a Windows-style path separator', () => {
    expect(titleFromFilename('C:\\Users\\me\\notes.txt')).toBe('notes')
  })

  it('leaves a filename with no extension unchanged', () => {
    expect(titleFromFilename('README')).toBe('README')
  })

  it('never treats a leading dot as an extension separator', () => {
    expect(titleFromFilename('.gitignore')).toBe('.gitignore')
  })
})
