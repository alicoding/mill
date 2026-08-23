import { describe, expect, it } from 'vitest'
import {
  basenameOf,
  computeFreshnessRollup,
  computeRollupSummary,
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

describe('computeRollupSummary', () => {
  // A Kind carrying a plain status field with no RollupDoneValues --
  // the pre-existing shape every already-seeded Kind has today.
  const plainKind = {
    ID: 'topic',
    Fields: [{ Key: 'status', Type: 'options', Options: ['Open', 'Done'] }],
  } as never

  // A ledger-shaped Kind, standing in for "Delivered feature" without
  // being it -- proves the derivation isn't hardcoded to that Kind, its
  // field name, or its option values.
  const ledgerKind = {
    ID: 'delivered-feature',
    Fields: [{
      Key: 'signoff', Type: 'options',
      Options: ['pending-verify', 'verified', 'verified-with-notes'],
      RollupDoneValues: ['verified', 'verified-with-notes'],
    }],
  } as never

  // A second, deliberately different Kind: different field key,
  // different option vocabulary, different "done" set -- the test the
  // brief requires proving nothing is tied to the ledger's own words.
  const reviewKind = {
    ID: 'review-item',
    Fields: [{
      Key: 'stage', Type: 'options',
      Options: ['todo', 'in-review', 'accepted', 'rejected'],
      RollupDoneValues: ['accepted', 'rejected'],
    }],
  } as never

  function kindMap(...kinds: unknown[]): Map<string, unknown> {
    return new Map((kinds as { ID: string }[]).map((k) => [k.ID, k]))
  }

  it('is null when no child carries a Kind declaring a rollup field', () => {
    const children = [
      { KindID: 'topic', Fields: { status: 'Open' } },
      { KindID: 'topic', Fields: { status: 'Done' } },
    ] as never
    expect(computeRollupSummary(children, kindMap(plainKind) as never)).toBeNull()
  })

  it('counts every child done when all carry a done value', () => {
    const children = [
      { KindID: 'delivered-feature', Fields: { signoff: 'verified' } },
      { KindID: 'delivered-feature', Fields: { signoff: 'verified-with-notes' } },
    ] as never
    expect(computeRollupSummary(children, kindMap(ledgerKind) as never)).toEqual({ done: 2, total: 2 })
  })

  it('counts zero done when none carry a done value', () => {
    const children = [
      { KindID: 'delivered-feature', Fields: { signoff: 'pending-verify' } },
      { KindID: 'delivered-feature', Fields: {} },
    ] as never
    expect(computeRollupSummary(children, kindMap(ledgerKind) as never)).toEqual({ done: 0, total: 2 })
  })

  it('tallies a mixed done/not-done set, and excludes non-participating Kinds', () => {
    const children = [
      { KindID: 'delivered-feature', Fields: { signoff: 'verified' } },
      { KindID: 'delivered-feature', Fields: { signoff: 'pending-verify' } },
      { KindID: 'topic', Fields: { status: 'Done' } },
    ] as never
    expect(computeRollupSummary(children, kindMap(ledgerKind, plainKind) as never)).toEqual({ done: 1, total: 2 })
  })

  it('works for a different Kind with a different field name and option vocabulary', () => {
    const children = [
      { KindID: 'review-item', Fields: { stage: 'accepted' } },
      { KindID: 'review-item', Fields: { stage: 'rejected' } },
      { KindID: 'review-item', Fields: { stage: 'in-review' } },
    ] as never
    expect(computeRollupSummary(children, kindMap(reviewKind) as never)).toEqual({ done: 2, total: 3 })
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
