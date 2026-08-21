import { describe, expect, it } from 'vitest'
import { isScrollingOverflow } from './scrollContainer'

describe('isScrollingOverflow', () => {
  it('is true for auto/scroll overflow with real overflowing extent', () => {
    expect(isScrollingOverflow('auto', 800, 400)).toBe(true)
    expect(isScrollingOverflow('scroll', 800, 400)).toBe(true)
  })
  it('is false for auto/scroll overflow with no real overflowing extent', () => {
    // The Primer PageLayout.Content trap this test pins: an ancestor
    // whose scrollHeight equals its clientHeight has nothing to
    // scroll, regardless of its own overflow value.
    expect(isScrollingOverflow('auto', 400, 400)).toBe(false)
    expect(isScrollingOverflow('scroll', 300, 400)).toBe(false)
  })
  it('is false for visible/hidden/clip overflow even with overflowing extent', () => {
    expect(isScrollingOverflow('visible', 800, 400)).toBe(false)
    expect(isScrollingOverflow('hidden', 800, 400)).toBe(false)
    expect(isScrollingOverflow('clip', 800, 400)).toBe(false)
  })
})
