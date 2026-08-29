import { describe, expect, it } from 'vitest'
import { runningRuns } from './trayPanelRuns'
import type { RunSummary } from '../../bindings/github.com/alicoding/mill/internal/services/executionsvc/models'

const run = (partial: Partial<RunSummary>): RunSummary =>
  ({ runID: 'r', workflowID: 'w', workflowLabel: 'W', status: 'SUCCESS', pending: null, ...partial }) as RunSummary

describe('runningRuns (goal 0189)', () => {
  it('keeps only in-flight statuses', () => {
    const runs = [
      run({ runID: 'a', status: 'RUNNING' }),
      run({ runID: 'b', status: 'PENDING' }),
      run({ runID: 'c', status: 'ENQUEUED' }),
      run({ runID: 'd', status: 'SUCCESS' }),
      run({ runID: 'e', status: 'ERROR' }),
      run({ runID: 'f', status: 'CANCELLED' }),
    ]
    expect(runningRuns(runs).map((r) => r.runID)).toEqual(['a', 'b', 'c'])
  })

  // A parked run belongs in the Needs-you section, never Running --
  // the two sections must partition, not overlap.
  it('excludes parked-awaiting-approval runs even when in-flight', () => {
    const parked = run({ runID: 'p', status: 'PENDING', pending: { nodeID: 'n' } as RunSummary['pending'] })
    expect(runningRuns([parked])).toEqual([])
  })
})
