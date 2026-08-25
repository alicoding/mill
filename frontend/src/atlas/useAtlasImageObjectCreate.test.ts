import { describe, expect, it } from 'vitest'
import { isImagePath } from './useAtlasImageObjectCreate'

describe('isImagePath (goal 0206)', () => {
  it('recognizes the recognized image extensions regardless of case', () => {
    expect(isImagePath('/tmp/photo.png')).toBe(true)
    expect(isImagePath('/tmp/PHOTO.PNG')).toBe(true)
    expect(isImagePath('/tmp/photo.jpg')).toBe(true)
    expect(isImagePath('/tmp/photo.jpeg')).toBe(true)
    expect(isImagePath('/tmp/photo.gif')).toBe(true)
    expect(isImagePath('/tmp/photo.webp')).toBe(true)
    expect(isImagePath('/tmp/photo.heic')).toBe(true)
  })

  it('recognizes an OS temp/promise path under /var/folders the same way', () => {
    expect(isImagePath('/var/folders/3k/abc123/T/TemporaryItems/screenshot.png')).toBe(true)
  })

  it('is false for an unrelated extension', () => {
    expect(isImagePath('/tmp/notes.md')).toBe(false)
    expect(isImagePath('/tmp/plan.drawio')).toBe(false)
    expect(isImagePath('/tmp/notes.pdf')).toBe(false)
  })
})
