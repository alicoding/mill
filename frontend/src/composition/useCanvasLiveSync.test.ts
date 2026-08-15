import { describe, expect, it } from 'vitest'
import { decideExternalSyncAction } from './useCanvasLiveSync'
import type { ScratchDraft } from './canvasScratch'
import { NodeKind } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'

// GAP B of the live-canvas-sync work: whether an external MCP
// definition edit applies immediately or needs the user's say-so
// depends entirely on whether the live draft is still exactly what
// this canvas last loaded/saved (the same id-agnostic comparison
// useCanvasHotExit.ts's own dirty check already uses, canvasScratch.ts's
// draftsEqual). decideExternalSyncAction is the pure decision point.

const baseline: ScratchDraft = {
  label: 'My workflow',
  description: '',
  nodes: [{ ID: 't', Kind: NodeKind.KindTrigger, NodeTypeID: 'trigger-manual', Config: {}, Position: { X: 0, Y: 0 } }],
  edges: [],
  notes: [],
}

describe('decideExternalSyncAction', () => {
  it('applies immediately when the live draft is identical to the baseline', () => {
    const currentDraft: ScratchDraft = { ...baseline, nodes: [...baseline.nodes] }
    expect(decideExternalSyncAction(currentDraft, baseline)).toBe('apply')
  })

  it('applies immediately even when node ids differ but the shape is the same (id-agnostic, matching draftsEqual)', () => {
    const currentDraft: ScratchDraft = {
      ...baseline,
      nodes: [{ ID: 'a-different-id', Kind: NodeKind.KindTrigger, NodeTypeID: 'trigger-manual', Config: {}, Position: { X: 0, Y: 0 } }],
    }
    expect(decideExternalSyncAction(currentDraft, baseline)).toBe('apply')
  })

  it('prompts when the live draft has an unsaved edit (label changed)', () => {
    const currentDraft: ScratchDraft = { ...baseline, label: 'My workflow (edited)' }
    expect(decideExternalSyncAction(currentDraft, baseline)).toBe('prompt')
  })

  it('prompts when the live draft has an unsaved edit (an extra node)', () => {
    const currentDraft: ScratchDraft = {
      ...baseline,
      nodes: [
        ...baseline.nodes,
        { ID: 'p', Kind: NodeKind.KindProcess, NodeTypeID: 'process-inject-text', Config: { text: 'draft edit' }, Position: { X: 0, Y: 120 } },
      ],
    }
    expect(decideExternalSyncAction(currentDraft, baseline)).toBe('prompt')
  })
})
