import { describe, expect, it } from 'vitest'
import { cardPageNavReducer, truncateBackTitle, type CardPageNavState } from './atlasCardPageNav'

function state(currentID: string, stack: string[] = []): CardPageNavState {
  return { currentID, stack }
}

describe('cardPageNavReducer', () => {
  it('navigate pushes the current card onto the stack and moves to the target', () => {
    const next = cardPageNavReducer(state('a'), { type: 'navigate', toID: 'b' })
    expect(next).toEqual(state('b', ['a']))
  })

  it('navigate chains across multiple hops, growing the stack in visit order', () => {
    let s = state('a')
    s = cardPageNavReducer(s, { type: 'navigate', toID: 'b' })
    s = cardPageNavReducer(s, { type: 'navigate', toID: 'c' })
    expect(s).toEqual(state('c', ['a', 'b']))
  })

  it('navigate to the currently-shown card is a no-op (returns the same state)', () => {
    const s = state('a', ['x'])
    expect(cardPageNavReducer(s, { type: 'navigate', toID: 'a' })).toBe(s)
  })

  it('back pops the most recent stack entry and shows it', () => {
    const s = state('c', ['a', 'b'])
    expect(cardPageNavReducer(s, { type: 'back' })).toEqual(state('b', ['a']))
  })

  it('back on an empty stack is a no-op (returns the same state)', () => {
    const s = state('a')
    expect(cardPageNavReducer(s, { type: 'back' })).toBe(s)
  })

  it('navigate then back returns exactly to the prior card with an empty stack', () => {
    let s = state('a')
    s = cardPageNavReducer(s, { type: 'navigate', toID: 'b' })
    s = cardPageNavReducer(s, { type: 'back' })
    expect(s).toEqual(state('a'))
  })

  it('reset clears the stack and jumps straight to the given card', () => {
    const s = state('c', ['a', 'b'])
    expect(cardPageNavReducer(s, { type: 'reset', toID: 'z' })).toEqual(state('z'))
  })
})

describe('truncateBackTitle', () => {
  it('passes a short title through untouched', () => {
    expect(truncateBackTitle('Vendor X')).toBe('Vendor X')
  })

  it('passes a title of exactly 24 characters through untouched', () => {
    const title = 'x'.repeat(24)
    expect(truncateBackTitle(title)).toBe(title)
  })

  it('truncates a longer title to 23 characters plus an ellipsis', () => {
    const title = 'A very long card title that overflows the back button'
    const result = truncateBackTitle(title)
    expect(result).toBe(`${title.slice(0, 23)}…`)
    expect(result.length).toBe(24)
  })
})
