import { useEffect } from 'react'
import type { Edge as RFEdge } from '@xyflow/react'
import type { NodeType, Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { CanvasNode } from './canvasStore'
import { toCanvasNodes, toRFEdges } from './canvasConversion'
import { buildScratchDraft, clearScratch, draftsEqual, readScratch, scheduleScratchWrite, type ScratchDraft } from './canvasScratch'
import { useAppStore } from '../shared/store'

// Split out of CompositionCanvas.tsx at the 500-line limit (CLAUDE.md)
// -- both halves of hot exit's own client-side logic
// (docs/goals/0012-authoring-hot-exit.md): computing the canvas's real
// starting content (possibly overridden by a restored scratch) and the
// debounced write/dirty-tracking effect that keeps that scratch in
// sync afterward. Neither is Composition-generic beyond this feature,
// so this stays a co-located file, not a shared/ promotion.

export interface InitialCanvasState {
  nodes: CanvasNode[]
  edges: RFEdge[]
  label: string
  description: string
  // True only when a pre-existing hot-exit scratch differed (content,
  // id-agnostic) from the saved/starter baseline at mount -- what
  // WorkTabShell.tsx's "Unsaved changes restored" banner gates on.
  restoredFromScratch: boolean
  // The saved workflow's real content (or the empty-starter content for
  // a brand-new workflow) -- what every later dirty check compares the
  // live draft against, deliberately NOT the restored scratch itself
  // (see useCanvasHotExit's own doc comment below).
  baseline: ScratchDraft
}

// Builds the canvas's starting nodes/edges/label/description -- either
// the saved workflow's own content, or a brand-new workflow's single
// starter node -- and decides whether a hot-exit scratch should
// override it. Called once, synchronously, from CanvasInner's own
// `useState` lazy initializer (not a useEffect) specifically so the
// very first render already reflects the right content: seeding
// createCanvasStore() via a follow-up `load()` call instead would mean
// `nodes`/`edges` briefly read stale/empty on mount, which would then
// make useCanvasHotExit's debounced dirty-check effect below see a
// false "everything just got deleted" transition before the real
// content ever arrived.
export function computeInitialCanvas(workflow: Workflow | null | undefined, nodeTypes: NodeType[], tabKey: string): InitialCanvasState {
  let nodes: CanvasNode[]
  let edges: RFEdge[]
  const label = workflow?.Label ?? ''
  const description = workflow?.Description ?? ''

  if (workflow) {
    nodes = toCanvasNodes(workflow.Nodes, nodeTypes)
    edges = toRFEdges(workflow.Edges)
  } else {
    // A brand-new workflow starts with one real node already placed
    // (SPEC.md §3), not a blank canvas.
    const starterType = nodeTypes.find((nt) => nt.ID === 'trigger-manual')
    nodes = starterType
      ? [
          {
            id: crypto.randomUUID(),
            type: starterType.Kind,
            position: { x: 80, y: 80 },
            data: { nodeTypeID: starterType.ID, kind: starterType.Kind, label: starterType.Label, output: starterType.Output ?? '', config: {} },
          },
        ]
      : []
    edges = []
  }

  const baseline = buildScratchDraft(label, description, nodes, edges)
  const scratch = readScratch(tabKey)
  if (scratch && !draftsEqual(scratch, baseline)) {
    return {
      nodes: toCanvasNodes(scratch.nodes, nodeTypes),
      edges: toRFEdges(scratch.edges),
      label: scratch.label,
      description: scratch.description,
      restoredFromScratch: true,
      baseline,
    }
  }
  return { nodes, edges, label, description, restoredFromScratch: false, baseline }
}

// Surfaces the mount-time restore decision into the shared store (once)
// and keeps a debounced hot-exit scratch write + live dirty flag in
// sync with every later nodes/edges/label/description change. Compares
// against `initial.baseline` -- NOT the restored scratch -- so a
// restored-but-untouched-since-restore canvas still reads dirty=true
// until a real Save, matching the "never ambiguous that it's
// uncommitted work" requirement. When the draft settles back to exactly
// the baseline (e.g. an undo), the stale scratch is discarded rather
// than left to linger.
export function useCanvasHotExit(
  tabKey: string,
  initial: InitialCanvasState,
  nodes: CanvasNode[],
  edges: RFEdge[],
  draftLabel: string,
  draftDescription: string,
): void {
  const setWorkTabDirty = useAppStore((s) => s.setWorkTabDirty)
  const setWorkTabRestored = useAppStore((s) => s.setWorkTabRestored)

  useEffect(() => {
    if (initial.restoredFromScratch) {
      setWorkTabRestored(tabKey, true)
      setWorkTabDirty(tabKey, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const current = buildScratchDraft(draftLabel, draftDescription, nodes, edges)
    const dirty = !draftsEqual(current, initial.baseline)
    setWorkTabDirty(tabKey, dirty)
    if (dirty) {
      scheduleScratchWrite(tabKey, current)
    } else {
      clearScratch(tabKey)
    }
  }, [nodes, edges, draftLabel, draftDescription, tabKey, initial.baseline, setWorkTabDirty])
}
