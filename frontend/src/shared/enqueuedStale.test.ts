import { describe, expect, it } from 'vitest'
import { isStuckEnqueued } from './enqueuedStale'

const NOW = Date.parse('2026-08-11T12:00:00Z')
const minutesAgo = (m: number) => new Date(NOW - m * 60 * 1000).toISOString()

describe('isStuckEnqueued', () => {
  it('is false for a fresh ENQUEUED run', () => {
    expect(isStuckEnqueued({ status: 'ENQUEUED', startedAt: minutesAgo(1) } as never, NOW)).toBe(false)
  })

  it('is true for an ENQUEUED run older than 5 minutes', () => {
    expect(isStuckEnqueued({ status: 'ENQUEUED', startedAt: minutesAgo(6) } as never, NOW)).toBe(true)
  })

  it('is false for a non-ENQUEUED run regardless of age', () => {
    expect(isStuckEnqueued({ status: 'RUNNING', startedAt: minutesAgo(30) } as never, NOW)).toBe(false)
  })

  it('is false when the run has a pending approval, even if ENQUEUED', () => {
    expect(isStuckEnqueued({ status: 'ENQUEUED', startedAt: minutesAgo(30), pending: {} } as never, NOW)).toBe(false)
  })
})
