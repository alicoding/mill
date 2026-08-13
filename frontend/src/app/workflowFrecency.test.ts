import { describe, expect, it } from 'vitest'
import { sortWorkflowsByFrecency, sortWorkflowsByPinnedAndFrecency } from './workflowFrecency'
import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'

// Minimal-but-valid Workflow fixture -- every field the interface
// declares, only ID/Label actually varying per test. Local to this
// test file (no existing test-fixture builder for Workflow anywhere
// in the frontend suite to reuse).
function makeWorkflow(id: string, label = id): Workflow {
  return {
    ID: id,
    Label: label,
    Description: '',
    Nodes: [],
    Edges: [],
    Attributes: [],
    BuiltIn: false,
    CreatedAt: '',
    UpdatedAt: '',
    Disabled: false,
    PublishedVersion: 0,
    Versions: [],
    Seed: { SeedRevision: 0, Modified: false },
  }
}

describe('sortWorkflowsByFrecency', () => {
  it('ranks a frequently-run workflow above a never-run one', () => {
    const neverRun = makeWorkflow('wf-never-run')
    const frequentlyRun = makeWorkflow('wf-frequently-run')
    const sorted = sortWorkflowsByFrecency([neverRun, frequentlyRun], { 'wf-frequently-run': 12 })
    expect(sorted.map((w) => w.ID)).toEqual(['wf-frequently-run', 'wf-never-run'])
  })

  it('ranks higher run counts above lower ones, not just run-vs-never', () => {
    const low = makeWorkflow('wf-low')
    const high = makeWorkflow('wf-high')
    const sorted = sortWorkflowsByFrecency([low, high], { 'wf-low': 2, 'wf-high': 9 })
    expect(sorted.map((w) => w.ID)).toEqual(['wf-high', 'wf-low'])
  })

  it('keeps original relative order for equal (including zero) run counts -- stable sort', () => {
    const a = makeWorkflow('wf-a')
    const b = makeWorkflow('wf-b')
    const c = makeWorkflow('wf-c')
    const sorted = sortWorkflowsByFrecency([a, b, c], {})
    expect(sorted.map((w) => w.ID)).toEqual(['wf-a', 'wf-b', 'wf-c'])
  })

  it('does not mutate the input array', () => {
    const list = [makeWorkflow('wf-1'), makeWorkflow('wf-2')]
    sortWorkflowsByFrecency(list, { 'wf-2': 5 })
    expect(list.map((w) => w.ID)).toEqual(['wf-1', 'wf-2'])
  })
})

describe('sortWorkflowsByPinnedAndFrecency', () => {
  it('sorts a pinned workflow above a higher-frecency unpinned one', () => {
    const pinned = makeWorkflow('wf-pinned')
    const frequentlyRun = makeWorkflow('wf-frequently-run')
    const sorted = sortWorkflowsByPinnedAndFrecency(
      [frequentlyRun, pinned],
      { 'wf-frequently-run': 99 },
      ['wf-pinned'],
    )
    expect(sorted.map((w) => w.ID)).toEqual(['wf-pinned', 'wf-frequently-run'])
  })

  it('orders multiple pinned workflows by pin order (pin recency), not frecency', () => {
    const a = makeWorkflow('wf-a')
    const b = makeWorkflow('wf-b')
    // b was run more often, but a was pinned first -- pin order wins
    // among pinned rows.
    const sorted = sortWorkflowsByPinnedAndFrecency([b, a], { 'wf-b': 50, 'wf-a': 1 }, ['wf-a', 'wf-b'])
    expect(sorted.map((w) => w.ID)).toEqual(['wf-a', 'wf-b'])
  })

  it('falls back to frecency ordering for the unpinned tail, stable for ties', () => {
    const pinned = makeWorkflow('wf-pinned')
    const high = makeWorkflow('wf-high')
    const low = makeWorkflow('wf-low')
    const zero1 = makeWorkflow('wf-zero-1')
    const zero2 = makeWorkflow('wf-zero-2')
    const sorted = sortWorkflowsByPinnedAndFrecency(
      [zero1, low, zero2, high, pinned],
      { high: 0, 'wf-high': 9, 'wf-low': 2 },
      ['wf-pinned'],
    )
    expect(sorted.map((w) => w.ID)).toEqual(['wf-pinned', 'wf-high', 'wf-low', 'wf-zero-1', 'wf-zero-2'])
  })

  it('a pinned id with no matching workflow is silently dropped, not rendered as a gap', () => {
    const a = makeWorkflow('wf-a')
    const sorted = sortWorkflowsByPinnedAndFrecency([a], {}, ['wf-deleted', 'wf-a'])
    expect(sorted.map((w) => w.ID)).toEqual(['wf-a'])
  })

  it('does not mutate the input array', () => {
    const list = [makeWorkflow('wf-1'), makeWorkflow('wf-2')]
    sortWorkflowsByPinnedAndFrecency(list, {}, ['wf-2'])
    expect(list.map((w) => w.ID)).toEqual(['wf-1', 'wf-2'])
  })
})
