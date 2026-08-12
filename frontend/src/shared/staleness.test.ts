import { describe, expect, it } from 'vitest'
import {
  ageTier, formatExpiresIn, formatLastChecked, isPollStale,
  MCP_WRITE_EXPIRY_MS, STALE_AGE_THRESHOLD_MS,
} from './staleness'

const NOW = Date.parse('2026-08-11T12:00:00Z')
const minutesAgo = (m: number) => new Date(NOW - m * 60 * 1000).toISOString()
const hoursAgo = (h: number) => new Date(NOW - h * 60 * 60 * 1000).toISOString()

describe('ageTier', () => {
  it('reads fresh under the 15-minute bar', () => {
    expect(ageTier(minutesAgo(5), NOW)).toBe('fresh')
    expect(ageTier(minutesAgo(14), NOW)).toBe('fresh')
  })

  it('reads aging at and past the 15-minute bar', () => {
    expect(ageTier(minutesAgo(15), NOW)).toBe('aging')
    expect(ageTier(hoursAgo(4), NOW)).toBe('aging')
  })

  it('treats a missing/unparseable timestamp as fresh, never inventing emphasis', () => {
    expect(ageTier(undefined, NOW)).toBe('fresh')
    expect(ageTier(null, NOW)).toBe('fresh')
    expect(ageTier('not-a-date', NOW)).toBe('fresh')
  })

  it('exposes the threshold as the shared constant', () => {
    expect(STALE_AGE_THRESHOLD_MS).toBe(15 * 60 * 1000)
  })
})

describe('formatExpiresIn', () => {
  it('counts down in hours from the 24h clock by default', () => {
    expect(formatExpiresIn(hoursAgo(1), MCP_WRITE_EXPIRY_MS, NOW)).toBe('expires in 23h')
    expect(formatExpiresIn(hoursAgo(20), MCP_WRITE_EXPIRY_MS, NOW)).toBe('expires in 4h')
  })

  it('switches to minutes under an hour remaining', () => {
    expect(formatExpiresIn(hoursAgo(23.5), MCP_WRITE_EXPIRY_MS, NOW)).toBe('expires in 30m')
  })

  it('renders "expires imminently" once the deadline has passed', () => {
    expect(formatExpiresIn(hoursAgo(25), MCP_WRITE_EXPIRY_MS, NOW)).toBe('expires imminently')
  })

  it('returns empty for a missing timestamp', () => {
    expect(formatExpiresIn(undefined, MCP_WRITE_EXPIRY_MS, NOW)).toBe('')
  })

  it('honors a custom expiry window', () => {
    expect(formatExpiresIn(minutesAgo(30), 60 * 60 * 1000, NOW)).toBe('expires in 30m')
  })
})

describe('isPollStale', () => {
  it('is false for a recent poll', () => {
    expect(isPollStale(minutesAgo(2), NOW)).toBe(false)
  })

  it('is true past the 5-minute bar', () => {
    expect(isPollStale(minutesAgo(6), NOW)).toBe(true)
  })

  it('is false when never polled (undefined) -- no noise', () => {
    expect(isPollStale(undefined, NOW)).toBe(false)
    expect(isPollStale(null, NOW)).toBe(false)
  })
})

describe('formatLastChecked', () => {
  it('is empty when not stale (fresh polling, no noise)', () => {
    expect(formatLastChecked(minutesAgo(1), NOW)).toBe('')
  })

  it('is empty when never polled', () => {
    expect(formatLastChecked(undefined, NOW)).toBe('')
  })

  it('renders "requester last checked Nm ago" once stale', () => {
    expect(formatLastChecked(minutesAgo(9), NOW)).toMatch(/^requester last checked .*ago$/)
  })
})
