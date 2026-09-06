import { describe, expect, it } from 'vitest'
import { isReviewablePark, pendingReviewCount } from './pendingReviewStore'

// Review is where a person answers something (goal 0328). A step-mode or
// breakpoint pause is the person who started the run pausing their own
// run -- nobody is being asked to decide anything -- so it must reach
// neither the queue, the sidebar badge, nor the launch notice, all three
// of which read this one predicate and this one count.
const park = (source?: string) => ({ pending: { source } })

describe('isReviewablePark', () => {
  it('keeps a guardrail policy ask, which carries no source', () => {
    expect(isReviewablePark(park() as never)).toBe(true)
    expect(isReviewablePark(park('') as never)).toBe(true)
  })

  it('excludes a debug park -- step mode and breakpoints alike', () => {
    expect(isReviewablePark(park('debug') as never)).toBe(false)
  })

  it('excludes a run that is not parked at all', () => {
    expect(isReviewablePark({ pending: null } as never)).toBe(false)
  })
})

describe('pendingReviewCount', () => {
  it('counts parked runs plus pending agent writes', () => {
    expect(pendingReviewCount({ pending: [{}, {}] as never, pendingWrites: [{}] as never })).toBe(3)
  })

  it('never counts a debug park, because such a run never enters `pending`', () => {
    const runs = [park(), park('debug'), park('debug')]
    const pending = runs.filter((r) => isReviewablePark(r as never))
    expect(pendingReviewCount({ pending: pending as never, pendingWrites: [] })).toBe(1)
  })
})

describe('isReviewablePark for a vault wait', () => {
  it('counts a run waiting on the vault: a person has to unlock it', () => {
    expect(isReviewablePark({ pending: { nodeID: 'n1', reason: 'vault-locked' } } as never)).toBe(true)
  })
})
