import { describe, expect, it } from 'vitest'
import { stormTick, STORM_THRESHOLD, STORM_WINDOW_MS, type StormState } from './renderStormGuard'

describe('stormTick', () => {
  it('stays quiet under sustained interaction-rate rendering', () => {
    const s: StormState = { windowStart: 0, count: 0 }
    // 120 renders/second for 10 seconds -- heavy drag territory.
    let tripped = false
    for (let t = 0; t < 10_000; t += 8) {
      tripped = stormTick(s, t) || tripped
    }
    expect(tripped).toBe(false)
  })

  it('trips on loop-rate rendering inside one window', () => {
    const s: StormState = { windowStart: 0, count: 0 }
    let tripped = false
    for (let i = 0; i < STORM_THRESHOLD + 2; i++) {
      tripped = stormTick(s, 100) || tripped
    }
    expect(tripped).toBe(true)
  })

  it('resets the count when the window elapses', () => {
    const s: StormState = { windowStart: 0, count: 0 }
    for (let i = 0; i < STORM_THRESHOLD; i++) stormTick(s, 0)
    expect(stormTick(s, STORM_WINDOW_MS + 1)).toBe(false)
    expect(s.count).toBe(1)
  })
})
