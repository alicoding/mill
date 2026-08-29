import { describe, expect, it } from 'vitest'
import { imagePathFromClipboardText, localPathFromPastedText, normalizeLocalPathInput, resolveDefaultKindID, resolveNoteCommitText, titleFromFilename, titleFromNoteText } from './atlasCreateHelpers'
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

describe('normalizeLocalPathInput', () => {
  it('passes a plain path through trimmed', () => {
    expect(normalizeLocalPathInput('  /Users/me/photo.png  ')).toBe('/Users/me/photo.png')
  })

  it('strips a file:// scheme', () => {
    expect(normalizeLocalPathInput('file:///Users/me/photo.png')).toBe('/Users/me/photo.png')
  })

  it('decodes percent-encoding in a dragged-in file:// URL', () => {
    expect(normalizeLocalPathInput('file:///Users/me/My%20Photo.png')).toBe('/Users/me/My Photo.png')
  })

  it('falls back to the undecoded remainder on malformed percent-encoding', () => {
    expect(normalizeLocalPathInput('file:///Users/me/broken%.png')).toBe('/Users/me/broken%.png')
  })
})

describe('resolveNoteCommitText', () => {
  // Regression (goal 0226): a re-edited note's commit used to call
  // .trim() before persisting, silently stripping whitespace the
  // author typed on purpose -- a note's text is markdown SOURCE, never
  // normalized. Proven here (pure, no CodeMirror/browser involved)
  // rather than by reconstructing an editor's DOM in e2e, since the
  // actual persisted value is a pure function of the input text.
  it('preserves leading and trailing whitespace exactly', () => {
    const text = '  # Heading\n\nbody text  \n'
    expect(resolveNoteCommitText(text)).toBe(text)
  })

  it('preserves interior blank lines and markdown syntax unchanged', () => {
    const text = '# Title\n\n- one\n- two'
    expect(resolveNoteCommitText(text)).toBe(text)
  })

  it('treats whitespace-only text as blank, skipping the write', () => {
    expect(resolveNoteCommitText('   \n  ')).toBeNull()
  })

  it('treats empty text as blank, skipping the write', () => {
    expect(resolveNoteCommitText('')).toBeNull()
  })
})

describe('imagePathFromClipboardText', () => {
  // Regression: the image paste zone answered only bitmap clipboard
  // data -- a pasted image-file path (text) was silently ignored.
  it('accepts a plain absolute image path', () => {
    expect(imagePathFromClipboardText('/Users/me/photo.png')).toBe('/Users/me/photo.png')
  })

  it('trims surrounding whitespace and a trailing newline', () => {
    expect(imagePathFromClipboardText(' /Users/me/photo.jpg \n')).toBe('/Users/me/photo.jpg')
  })

  it('strips matched wrapping quotes from a terminal-copied path', () => {
    expect(imagePathFromClipboardText('"/Users/me/My Photo.png"')).toBe('/Users/me/My Photo.png')
    expect(imagePathFromClipboardText("'/Users/me/photo.webp'")).toBe('/Users/me/photo.webp')
  })

  it('resolves a file:// URL through the same normalization the picker uses', () => {
    expect(imagePathFromClipboardText('file:///Users/me/My%20Photo.png')).toBe('/Users/me/My Photo.png')
  })

  it('takes only the first line of a uri-list flavor, in preference order', () => {
    expect(imagePathFromClipboardText('file:///a/first.png\nfile:///b/second.png', '/c/plain.png')).toBe('/a/first.png')
  })

  it('falls through an unusable first flavor to a later one', () => {
    expect(imagePathFromClipboardText('', '/Users/me/photo.gif')).toBe('/Users/me/photo.gif')
  })

  it('passes an image URL through untouched for the server-side recognizer', () => {
    expect(imagePathFromClipboardText('https://example.com/pics/logo.png')).toBe('https://example.com/pics/logo.png')
  })

  it('rejects a path with a non-image extension', () => {
    expect(imagePathFromClipboardText('/Users/me/notes.txt')).toBeNull()
  })

  it('rejects prose that is not a path at all', () => {
    expect(imagePathFromClipboardText('hello world')).toBeNull()
  })

  it('rejects empty input', () => {
    expect(imagePathFromClipboardText('', '   ')).toBeNull()
  })
})

describe('localPathFromPastedText', () => {
  // The board paste door's file-drop gate: pasting a local file path
  // must route like dropping that file, and nothing else may.
  it('accepts an absolute path', () => {
    expect(localPathFromPastedText('/Users/me/notes/plan.md')).toBe('/Users/me/notes/plan.md')
  })

  it('accepts a quoted absolute path', () => {
    expect(localPathFromPastedText('"/Users/me/My Docs/plan.md"')).toBe('/Users/me/My Docs/plan.md')
  })

  it('accepts a file:// URL, percent-decoded', () => {
    expect(localPathFromPastedText('file:///Users/me/My%20Docs/plan.md')).toBe('/Users/me/My Docs/plan.md')
  })

  it('accepts a directory path (no extension required)', () => {
    expect(localPathFromPastedText('/Users/me/project')).toBe('/Users/me/project')
  })

  it('rejects multi-line text even when the first line is a path', () => {
    expect(localPathFromPastedText('/Users/me/plan.md\nand more prose')).toBeNull()
  })

  it('rejects relative paths', () => {
    expect(localPathFromPastedText('notes/plan.md')).toBeNull()
  })

  it('rejects http URLs', () => {
    expect(localPathFromPastedText('https://example.com/plan.md')).toBeNull()
  })

  it('rejects ordinary prose', () => {
    expect(localPathFromPastedText('meet at the usual place')).toBeNull()
  })

  it('rejects empty and whitespace text', () => {
    expect(localPathFromPastedText('   ')).toBeNull()
  })
})
