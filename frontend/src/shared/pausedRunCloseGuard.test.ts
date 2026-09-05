import { describe, expect, it } from 'vitest'
import { pausedRunForCloseRequest } from './workTabs'

// Leaving the editor is the last moment to decide what happens to a run
// still sitting on a step (goal 0328) -- so the guard has to agree with
// the close request about WHICH tabs are going away, including the bulk
// closes where the tab being asked about isn't the one clicked.
const tabs = [
  { key: 'a', kind: 'workflow-edit', workflowId: 'wf-1' },
  { key: 'b', kind: 'workflow-edit', workflowId: 'wf-2' },
  { key: 'c', kind: 'request-view' },
]
const paused = [{ runID: 'run-1', workflowID: 'wf-2', pending: { nodeID: 'n1', nodeTypeLabel: 'Send', nodeTypeID: 'http' } }]

describe('pausedRunForCloseRequest', () => {
  it('finds the paused run behind the one tab being closed', () => {
    expect(pausedRunForCloseRequest(tabs, paused, { kind: 'one', key: 'b' })?.runID).toBe('run-1')
  })

  it('says nothing when the closing tab is a different workflow', () => {
    expect(pausedRunForCloseRequest(tabs, paused, { kind: 'one', key: 'a' })).toBeNull()
  })

  it('asks on a close-all that sweeps the paused workflow up with the rest', () => {
    expect(pausedRunForCloseRequest(tabs, paused, { kind: 'all' })?.runID).toBe('run-1')
  })

  it('asks on close-others only when the kept tab is not the paused one', () => {
    expect(pausedRunForCloseRequest(tabs, paused, { kind: 'others', keepKey: 'a' })?.runID).toBe('run-1')
    expect(pausedRunForCloseRequest(tabs, paused, { kind: 'others', keepKey: 'b' })).toBeNull()
  })

  it('ignores a non-workflow tab, which can hold no run', () => {
    expect(pausedRunForCloseRequest(tabs, paused, { kind: 'one', key: 'c' })).toBeNull()
  })

  it('says nothing when no run is paused at all', () => {
    expect(pausedRunForCloseRequest(tabs, [], { kind: 'all' })).toBeNull()
  })
})
