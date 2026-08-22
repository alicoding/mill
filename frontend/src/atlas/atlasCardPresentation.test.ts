import { describe, expect, it } from 'vitest'
import {
  basenameOf,
  computeFreshnessRollup,
  daysSinceSync,
  deriveFileTag,
  freshnessDotColor,
  hasMirror,
  hostnameOf,
} from './atlasCardPresentation'

describe('deriveFileTag', () => {
  it('reads MD from a .md MirrorPath', () => {
    expect(deriveFileTag({ Source: '', MirrorPath: '/notes/plan.md' })).toEqual({ label: 'MD', color: 'success' })
  })
  it('reads IMG from an image MirrorPath extension', () => {
    expect(deriveFileTag({ Source: '', MirrorPath: '/assets/logo.png' })).toEqual({ label: 'IMG', color: 'attention' })
  })
  it('reads PDF from a .pdf MirrorPath', () => {
    expect(deriveFileTag({ Source: '', MirrorPath: '/docs/charter.pdf' })).toEqual({ label: 'PDF', color: 'danger' })
  })
  it('falls back to URL when only Source is set', () => {
    expect(deriveFileTag({ Source: 'https://example.com', MirrorPath: '' })).toEqual({ label: 'URL', color: 'attention' })
  })
  it('prefers the MirrorPath tag over Source when both are set', () => {
    expect(deriveFileTag({ Source: 'https://example.com', MirrorPath: '/notes/plan.md' })).toEqual({ label: 'MD', color: 'success' })
  })
  it('returns no tag for an unrecognized MirrorPath extension with no Source', () => {
    expect(deriveFileTag({ Source: '', MirrorPath: '/data/table.csv' })).toBeNull()
  })
  it('returns no tag when neither Source nor MirrorPath is set', () => {
    expect(deriveFileTag({ Source: '', MirrorPath: '' })).toBeNull()
  })
})

describe('hasMirror / freshnessDotColor', () => {
  it('is absent (null) when no MirrorPath is set', () => {
    expect(hasMirror({ MirrorPath: '' })).toBe(false)
    expect(freshnessDotColor({ MirrorPath: '', LastSyncedAt: '' })).toBeNull()
  })
  it('is fresh within the 7-day window', () => {
    const now = Date.parse('2026-01-10T00:00:00Z')
    const synced = '2026-01-05T00:00:00Z'
    expect(freshnessDotColor({ MirrorPath: '/x.md', LastSyncedAt: synced }, now)).toBe('fresh')
  })
  it('is stale past the 7-day window', () => {
    const now = Date.parse('2026-01-10T00:00:00Z')
    const synced = '2025-12-01T00:00:00Z'
    expect(freshnessDotColor({ MirrorPath: '/x.md', LastSyncedAt: synced }, now)).toBe('stale')
  })
  it('is stale when a mirror is set but never synced', () => {
    expect(freshnessDotColor({ MirrorPath: '/x.md', LastSyncedAt: '' })).toBe('stale')
  })
})

describe('computeFreshnessRollup', () => {
  it('tallies only children that carry a mirror', () => {
    const now = Date.parse('2026-01-10T00:00:00Z')
    const children = [
      { MirrorPath: '/a.md', LastSyncedAt: '2026-01-09T00:00:00Z' },
      { MirrorPath: '/b.md', LastSyncedAt: '2025-01-01T00:00:00Z' },
      { MirrorPath: '', LastSyncedAt: '' },
    ] as never
    expect(computeFreshnessRollup(children, now)).toEqual({ fresh: 1, stale: 1 })
  })
  it('is all zero when no child has a mirror', () => {
    expect(computeFreshnessRollup([{ MirrorPath: '' }] as never)).toEqual({ fresh: 0, stale: 0 })
  })
})

describe('hostnameOf', () => {
  it('extracts the host from a full URL', () => {
    expect(hostnameOf('https://example.com/statement-of-work')).toBe('example.com')
  })
  it('falls back to the raw value when it does not parse as a URL', () => {
    expect(hostnameOf('not a url')).toBe('not a url')
  })
})

describe('basenameOf', () => {
  it('returns the last path segment', () => {
    expect(basenameOf('/Users/ali/notes/plan.md')).toBe('plan.md')
    expect(basenameOf('Reports/Q1 Summary.md')).toBe('Q1 Summary.md')
  })
})

describe('daysSinceSync', () => {
  it('is 0 for a mirror that has never synced', () => {
    expect(daysSinceSync('')).toBe(0)
  })
  it('floors the whole-day count since LastSyncedAt', () => {
    const now = Date.parse('2026-01-10T00:00:00Z')
    expect(daysSinceSync('2026-01-05T00:00:00Z', now)).toBe(5)
  })
})
