import { describe, it, expect } from 'vitest'
import { hasDraftDrift } from './draftDrift'
import type { Workflow, Node } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { NodeKind } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'

// hasDraftDrift backs the Workflows-list Run button's honest tooltip
// (docs/goals/0006-trigger-aware-workflows-list.md, decision 1) --
// covered directly (.claude/rules/testing.md) since it's a pure
// comparison function with real edge cases (never published, no
// matching snapshot, key-order-only differences) worth locking down.

function node(id: string, nodeTypeID: string, config: Record<string, string> = {}): Node {
  return { ID: id, Kind: NodeKind.KindTrigger, NodeTypeID: nodeTypeID, Config: config, Position: { X: 0, Y: 0 } }
}

function baseWorkflow(overrides: Partial<Workflow>): Workflow {
  return {
    ID: 'wf-1', Label: 'Test workflow', Description: '', Nodes: [], Edges: [], Attributes: [],
    BuiltIn: false, Disabled: false, PublishedVersion: 0, Versions: [],
    CreatedAt: '2026-01-01T00:00:00Z', UpdatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('hasDraftDrift', () => {
  it('is false for a never-published workflow', () => {
    const wf = baseWorkflow({ PublishedVersion: 0, Nodes: [node('n1', 'trigger-manual')] })
    expect(hasDraftDrift(wf)).toBe(false)
  })

  it('is false when the draft matches its published snapshot', () => {
    const nodes = [node('n1', 'trigger-schedule', { cron: '0 9 * * *' })]
    const wf = baseWorkflow({
      PublishedVersion: 1,
      Nodes: nodes,
      Versions: [{ Version: 1, SavedAt: '2026-01-01T00:00:00Z', Label: 'Test workflow', Description: '', Nodes: nodes, Edges: [], Attributes: [] }],
    })
    expect(hasDraftDrift(wf)).toBe(false)
  })

  it('is true when the draft has an edited node the published snapshot lacks', () => {
    const publishedNodes = [node('n1', 'trigger-schedule', { cron: '0 9 * * *' })]
    const draftNodes = [node('n1', 'trigger-schedule', { cron: '0 10 * * *' })]
    const wf = baseWorkflow({
      PublishedVersion: 1,
      Nodes: draftNodes,
      Versions: [{ Version: 1, SavedAt: '2026-01-01T00:00:00Z', Label: 'Test workflow', Description: '', Nodes: publishedNodes, Edges: [], Attributes: [] }],
    })
    expect(hasDraftDrift(wf)).toBe(true)
  })

  it('is not fooled by config key insertion order alone', () => {
    const wf = baseWorkflow({
      PublishedVersion: 1,
      Nodes: [{ ID: 'n1', Kind: NodeKind.KindTrigger, NodeTypeID: 'trigger-filesystem-watch', Config: { pattern: '*.md', path: '/tmp' }, Position: { X: 0, Y: 0 } }],
      Versions: [{
        Version: 1, SavedAt: '2026-01-01T00:00:00Z', Label: 'Test workflow', Description: '',
        Nodes: [{ ID: 'n1', Kind: NodeKind.KindTrigger, NodeTypeID: 'trigger-filesystem-watch', Config: { path: '/tmp', pattern: '*.md' }, Position: { X: 0, Y: 0 } }],
        Edges: [], Attributes: [],
      }],
    })
    expect(hasDraftDrift(wf)).toBe(false)
  })

  it('is false when PublishedVersion points at a since-removed snapshot', () => {
    const wf = baseWorkflow({ PublishedVersion: 3, Nodes: [node('n1', 'trigger-manual')], Versions: [] })
    expect(hasDraftDrift(wf)).toBe(false)
  })
})
