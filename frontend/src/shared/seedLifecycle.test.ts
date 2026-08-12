import { describe, expect, it } from 'vitest'
import { describeSeedReset } from './seedLifecycle'

describe('describeSeedReset', () => {
  it('is disabled/current when unmodified and at the current revision', () => {
    const got = describeSeedReset({ SeedRevision: 1, Modified: false }, 1)
    expect(got).toEqual({ label: 'Up to date with shipped example', disabled: true })
  })

  it('offers reset, labeled with the current revision, when Modified', () => {
    const got = describeSeedReset({ SeedRevision: 1, Modified: true }, 1)
    expect(got).toEqual({ label: 'Reset to shipped example v1', disabled: false })
  })

  it('offers reset when unmodified but stale relative to a newer shipped revision', () => {
    const got = describeSeedReset({ SeedRevision: 1, Modified: false }, 2)
    expect(got).toEqual({ label: 'Reset to shipped example v2', disabled: false })
  })

  it('a Modified row stays reset-offered even if its own frozen revision is already current', () => {
    // The one-way latch is authoritative -- Modified always wins,
    // regardless of how SeedRevision compares (docs/goals/0037's core
    // design point: never re-derived from a revision/content diff).
    const got = describeSeedReset({ SeedRevision: 5, Modified: true }, 1)
    expect(got.disabled).toBe(false)
  })
})
