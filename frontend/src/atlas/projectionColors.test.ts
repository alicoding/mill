import { describe, expect, it } from 'vitest'
import { optionColor } from './projectionColors'

describe('optionColor', () => {
  it('assigns the palette by option index, stable everywhere', () => {
    const opts = ['healthy', 'blocked', 'waiting']
    expect(optionColor(opts, null, 'healthy')).toBe('success')
    expect(optionColor(opts, null, 'blocked')).toBe('danger')
    expect(optionColor(opts, null, 'waiting')).toBe('attention')
  })
  it('explicit OptionColors win over the palette', () => {
    expect(optionColor(['a', 'b'], ['done', ''], 'a')).toBe('done')
    expect(optionColor(['a', 'b'], ['done', ''], 'b')).toBe('danger')
  })
  it('a value outside the declared options carries no color', () => {
    expect(optionColor(['a'], null, 'zzz')).toBeNull()
    expect(optionColor(null, null, 'a')).toBeNull()
  })
  it('ignores an unknown explicit color name (fails safe to the palette)', () => {
    expect(optionColor(['a'], ['hotpink'], 'a')).toBe('success')
  })
})
