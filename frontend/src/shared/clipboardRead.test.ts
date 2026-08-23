import { describe, expect, it } from 'vitest'
import { readClipboardImageFile } from './clipboardRead'
import type { ClipboardImageSource } from './clipboardRead'

function pngFile(): File {
  return new File(['fake-bytes'], 'pasted.png', { type: 'image/png' })
}

function textFile(): File {
  return new File(['hello'], 'notes.txt', { type: 'text/plain' })
}

describe('readClipboardImageFile', () => {
  it('returns the image file from clipboardData.items', () => {
    const file = pngFile()
    const source: ClipboardImageSource = {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
      files: [],
    }
    expect(readClipboardImageFile(source)).toBe(file)
  })

  it('falls back to clipboardData.files when items carries no image', () => {
    const file = pngFile()
    const source: ClipboardImageSource = { items: [], files: [file] }
    expect(readClipboardImageFile(source)).toBe(file)
  })

  it('ignores a non-image file (a copied Finder file with no image type)', () => {
    const source: ClipboardImageSource = { items: [], files: [textFile()] }
    expect(readClipboardImageFile(source)).toBeNull()
  })

  it('returns null for plain text/HTML paste (no files at all)', () => {
    const source: ClipboardImageSource = { items: [], files: [] }
    expect(readClipboardImageFile(source)).toBeNull()
  })
})
