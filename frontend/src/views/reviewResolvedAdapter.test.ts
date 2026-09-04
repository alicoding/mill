import { describe, expect, it, vi } from 'vitest'
import { RunKind, type MCPWriteResolved, type RunSummary } from '../shared/bindings'
import { buildResolvedEntries, resolvedEntryToInventoryItem } from './reviewResolvedAdapter'
import { useAppStore } from '../shared/store'

const t = (key: string) => key

const run = (extra: Partial<RunSummary> = {}): RunSummary => ({
  runID: 'run-1',
  workflowID: 'wf-1',
  workflowLabel: 'Example workflow',
  status: 'SUCCESS',
  kind: RunKind.$zero,
  output: '',
  startedAt: '2026-01-01T00:00:00Z',
  completedAt: '2026-01-01T00:01:00Z',
  error: '',
  version: 1,
  resolution: 'approved',
  values: null,
  ...extra,
})

const write = (extra: Partial<MCPWriteResolved> = {}): MCPWriteResolved => ({
  id: 'write-1',
  description: 'Import workflow',
  status: 'approved',
  createdAt: '2026-01-01T00:00:00Z',
  resolvedAt: '2026-01-01T00:02:00Z',
  ...extra,
})

describe('buildResolvedEntries', () => {
  it('merges resolved runs and resolved writes, newest first', () => {
    const entries = buildResolvedEntries(
      [run({ runID: 'older', completedAt: '2026-01-01T00:00:00Z' })],
      [write({ id: 'newer', resolvedAt: '2026-01-01T00:05:00Z' })],
      '',
    )
    expect(entries.map((e) => e.key)).toEqual(['newer', 'older'])
  })

  it('excludes resolved writes entirely once a workflow filter narrows the runs', () => {
    const entries = buildResolvedEntries(
      [run({ runID: 'a', workflowID: 'wf-1' }), run({ runID: 'b', workflowID: 'wf-2' })],
      [write()],
      'wf-1',
    )
    expect(entries.map((e) => e.key)).toEqual(['a'])
  })
})

describe('resolvedEntryToInventoryItem', () => {
  it('maps a resolved run onto the run entity, opening it through the run.open command', async () => {
    const requestOpenWorkflow = vi.fn()
    useAppStore.setState({ requestOpenWorkflow })
    const theRun = run({ resolution: 'denied' })
    const item = resolvedEntryToInventoryItem({ kind: 'run', key: theRun.runID, time: 0, run: theRun }, { t })
    expect(item.entity).toBe('run')
    expect(item.label).toBe('Example workflow')
    expect(item.description).toBe('denied')
    expect(item.updatedAt).toBe(theRun.startedAt)
    expect(item.createdAt).toBe(theRun.startedAt)
    expect(item.menuActions).toEqual([])
    item.onOpen()
    // runCommand resolves on a microtask -- the command itself is
    // synchronous, so one flush is enough.
    await Promise.resolve()
    expect(requestOpenWorkflow).toHaveBeenCalledWith('wf-1', 'run-1')
  })

  it('maps a resolved MCP write onto its own entity with an inert onOpen', () => {
    const requestOpenWorkflow = vi.fn()
    useAppStore.setState({ requestOpenWorkflow })
    const theWrite = write({ status: 'denied' })
    const item = resolvedEntryToInventoryItem({ kind: 'mcp-write', key: theWrite.id, time: 0, write: theWrite }, { t })
    expect(item.entity).toBe('mcpwrite')
    expect(item.label).toBe('Import workflow')
    expect(item.description).toBe('denied')
    expect(item.updatedAt).toBe(theWrite.resolvedAt)
    expect(() => item.onOpen()).not.toThrow()
    expect(requestOpenWorkflow).not.toHaveBeenCalled()
  })
})
