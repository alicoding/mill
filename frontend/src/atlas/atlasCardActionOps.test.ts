import { describe, expect, it } from 'vitest'
import { nextActionsOnAdd, nextActionsOnRemove } from './atlasCardActionOps'

describe('nextActionsOnAdd', () => {
  it('appends a new workflow', () => {
    expect(nextActionsOnAdd(['a'], 'b')).toEqual(['a', 'b'])
  })
  it('ignores an empty id', () => {
    const cur = ['a']
    expect(nextActionsOnAdd(cur, '')).toBe(cur)
  })
  it('ignores a duplicate', () => {
    const cur = ['a', 'b']
    expect(nextActionsOnAdd(cur, 'a')).toBe(cur)
  })
})

describe('nextActionsOnRemove', () => {
  it('removes an attached workflow', () => {
    expect(nextActionsOnRemove(['a', 'b'], 'a')).toEqual(['b'])
  })
  it('is a no-op for an unattached workflow', () => {
    const cur = ['a']
    expect(nextActionsOnRemove(cur, 'x')).toBe(cur)
  })
})
