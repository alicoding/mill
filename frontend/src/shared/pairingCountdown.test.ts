import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatCountdown, gainedMember, isExpired, remainingMs } from './pairingCountdown'

// Pure math only -- the ticking hook itself is thin glue over these
// functions, proven live through the screenshot pass rather than a
// component render (vite.config.ts: components are proven in e2e, not
// Vitest unit tests, in this repo).
describe('pairingCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts down from the server-issued expiry as time advances', () => {
    const expiresAt = new Date('2026-01-01T00:05:00.000Z').toISOString()
    expect(remainingMs(expiresAt)).toBe(5 * 60 * 1000)

    vi.advanceTimersByTime(4 * 60 * 1000 + 23_000)
    expect(remainingMs(expiresAt)).toBe(37_000)
  })

  it('formats the remaining time as mm:ss, rounded up to the next second', () => {
    expect(formatCountdown(5 * 60 * 1000)).toBe('5:00')
    expect(formatCountdown(277_000)).toBe('4:37')
    expect(formatCountdown(500)).toBe('0:01')
    expect(formatCountdown(0)).toBe('0:00')
  })

  it('never reports negative time once the clock passes expiry', () => {
    const expiresAt = new Date('2026-01-01T00:05:00.000Z').toISOString()
    vi.advanceTimersByTime(6 * 60 * 1000)
    expect(remainingMs(expiresAt)).toBe(0)
    expect(formatCountdown(remainingMs(expiresAt))).toBe('0:00')
  })

  it('is expired only once the clock reaches the server TTL, never before', () => {
    const expiresAt = new Date('2026-01-01T00:05:00.000Z').toISOString()
    vi.advanceTimersByTime(4 * 60 * 1000 + 59_000)
    expect(isExpired(expiresAt)).toBe(false)

    vi.advanceTimersByTime(1_000)
    expect(isExpired(expiresAt)).toBe(true)
  })

  it('reports a gained member only once the fresh count exceeds the count at mint time', () => {
    expect(gainedMember(0, 0)).toBe(false)
    expect(gainedMember(1, 1)).toBe(false)
    expect(gainedMember(0, 1)).toBe(true)
    expect(gainedMember(2, 3)).toBe(true)
  })
})
