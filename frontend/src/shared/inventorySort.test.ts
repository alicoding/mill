import { describe, expect, it } from 'vitest'
import { formatUpdated, sortByUpdatedDesc } from './inventorySort'

interface Item {
  id: string
  updatedAt: string
}

const item = (id: string, updatedAt: string): Item => ({ id, updatedAt })

describe('sortByUpdatedDesc', () => {
  it('orders newest UpdatedAt first', () => {
    const items = [
      item('a', '2026-01-01T00:00:00Z'),
      item('b', '2026-03-01T00:00:00Z'),
      item('c', '2026-02-01T00:00:00Z'),
    ]
    expect(sortByUpdatedDesc(items, (i) => i.updatedAt).map((i) => i.id)).toEqual(['b', 'c', 'a'])
  })

  it('sorts a zero (unstamped) Go time.Time below every stamped item', () => {
    const items = [
      item('zero', '0001-01-01T00:00:00Z'),
      item('stamped', '2026-01-01T00:00:00Z'),
    ]
    expect(sortByUpdatedDesc(items, (i) => i.updatedAt).map((i) => i.id)).toEqual(['stamped', 'zero'])
  })

  it('preserves the original relative order among unstamped items (stability, migration-free)', () => {
    const items = [
      item('legacy-1', ''),
      item('legacy-2', '0001-01-01T00:00:00Z'),
      item('legacy-3', 'not-a-date'),
    ]
    expect(sortByUpdatedDesc(items, (i) => i.updatedAt).map((i) => i.id)).toEqual(['legacy-1', 'legacy-2', 'legacy-3'])
  })

  it('does not reorder unstamped items relative to each other even when interleaved with stamped ones', () => {
    const items = [
      item('legacy-1', ''),
      item('stamped', '2026-01-01T00:00:00Z'),
      item('legacy-2', ''),
    ]
    expect(sortByUpdatedDesc(items, (i) => i.updatedAt).map((i) => i.id)).toEqual(['stamped', 'legacy-1', 'legacy-2'])
  })

  it('tolerates a forged/future timestamp by ordering it first, not rejecting it', () => {
    const items = [
      item('now', new Date().toISOString()),
      item('future', '2999-01-01T00:00:00Z'),
    ]
    expect(sortByUpdatedDesc(items, (i) => i.updatedAt).map((i) => i.id)).toEqual(['future', 'now'])
  })

  it('returns a new array and does not mutate the input', () => {
    const items = [item('a', '2026-01-01T00:00:00Z'), item('b', '2026-02-01T00:00:00Z')]
    const original = [...items]
    sortByUpdatedDesc(items, (i) => i.updatedAt)
    expect(items).toEqual(original)
  })
})

describe('formatUpdated', () => {
  it('returns empty string for an unstamped (zero Go time.Time) value', () => {
    expect(formatUpdated('0001-01-01T00:00:00Z')).toBe('')
  })

  it('returns empty string for an empty or garbage value', () => {
    expect(formatUpdated('')).toBe('')
    expect(formatUpdated('not-a-date')).toBe('')
    expect(formatUpdated(undefined)).toBe('')
  })

  it('renders minutes-ago for a recent timestamp', () => {
    const ts = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    expect(formatUpdated(ts)).toMatch(/minute/)
  })

  it('renders hours-ago for a same-day timestamp', () => {
    const ts = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    expect(formatUpdated(ts)).toMatch(/hour/)
  })

  it('renders "just now" for a sub-minute timestamp', () => {
    const ts = new Date(Date.now() - 2000).toISOString()
    expect(formatUpdated(ts)).toBe('just now')
  })

  it('falls back to a locale date beyond ~7 days', () => {
    const ts = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const out = formatUpdated(ts)
    // Not a relative-time phrase, and not empty.
    expect(out).not.toBe('')
    expect(out).not.toMatch(/ago|minute|hour|day|week|month|year/)
  })
})
