import { describe, expect, it } from 'vitest'
import { setAtlasShapeRotateLive, useAtlasShapeRotateLiveStore } from './atlasShapeRotateLiveStore'

describe('atlasShapeRotateLiveStore', () => {
  it('has no live override for an object that never set one', () => {
    expect(useAtlasShapeRotateLiveStore.getState().live['obj-1']).toBeUndefined()
  })

  it('records a live angle for one object without touching another', () => {
    setAtlasShapeRotateLive('obj-1', 45)
    expect(useAtlasShapeRotateLiveStore.getState().live['obj-1']).toBe(45)
    expect(useAtlasShapeRotateLiveStore.getState().live['obj-2']).toBeUndefined()
  })

  it('clears an object\'s live override on a null write, leaving the key absent', () => {
    setAtlasShapeRotateLive('obj-1', 90)
    setAtlasShapeRotateLive('obj-1', null)
    expect('obj-1' in useAtlasShapeRotateLiveStore.getState().live).toBe(false)
  })

  it('a null write for an object with no override is a no-op', () => {
    const before = useAtlasShapeRotateLiveStore.getState().live
    setAtlasShapeRotateLive('never-set', null)
    expect(useAtlasShapeRotateLiveStore.getState().live).toBe(before)
  })
})
