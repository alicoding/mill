import { useEffect } from 'react'
import type { Edge as RFEdge } from '@xyflow/react'
import type { NodeType, Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { CanvasNode, CanvasNoteNode } from './canvasStore'
import { toCanvasNodes, toCanvasNotes, toRFEdges } from './canvasConversion'
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
  notes: CanvasNoteNode[]
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
// `readOnly` (docs/goals/0022-workflow-view-mode.md): a tab opened in
// VIEW mode never checks for a hot-exit scratch at all -- a view tab
// shows exactly the saved content, nothing to restore, since nothing
// can have diverged from it (interactions are disabled). This is also
// what keeps a stale scratch from a genuinely different, since-closed
// edit session from silently resurfacing just because someone later
// opens the same workflow to look at it. Only ever false for a
// 'workflow-new' tab (composing is always editing) or a
// 'workflow-edit' tab whose mode is 'edit' at MOUNT time -- switching
// view->edit later doesn't retroactively re-check scratch (see
// useCanvasHotExit's own readOnly gate below for why that's fine).
export function computeInitialCanvas(workflow: Workflow | null | undefined, nodeTypes: NodeType[], tabKey: string, readOnly: boolean): InitialCanvasState {
  let nodes: CanvasNode[]
  let edges: RFEdge[]
  let notes: CanvasNoteNode[]
  const label = workflow?.Label ?? ''
  const description = workflow?.Description ?? ''

  if (workflow) {
    nodes = toCanvasNodes(workflow.Nodes, nodeTypes)
    edges = toRFEdges(workflow.Edges)
    notes = toCanvasNotes(workflow.Notes)
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
    notes = []
  }

  const baseline = buildScratchDraft(label, description, nodes, edges, notes)
  if (readOnly) {
    return { nodes, edges, notes, label, description, restoredFromScratch: false, baseline }
  }
  const scratch = readScratch(tabKey)
  if (scratch && !draftsEqual(scratch, baseline)) {
    return {
      nodes: toCanvasNodes(scratch.nodes, nodeTypes),
      edges: toRFEdges(scratch.edges),
      notes: toCanvasNotes(scratch.notes),
      label: scratch.label,
      description: scratch.description,
      restoredFromScratch: true,
      baseline,
    }
  }
  return { nodes, edges, notes, label, description, restoredFromScratch: false, baseline }
}

// Surfaces the mount-time restore decision into the shared store (once)
// and keeps a debounced hot-exit scratch write + live dirty flag in
// sync with every later nodes/edges/label/description change. Compares
// against `baseline` -- NOT the restored scratch -- so a
// restored-but-untouched-since-restore canvas still reads dirty=true
// until a real Save, matching the "never ambiguous that it's
// uncommitted work" requirement. When the draft settles back to exactly
// the baseline (e.g. an undo), the stale scratch is discarded rather
// than left to linger.
//
// `restoredFromScratch`/`baseline` are taken as their own params rather
// than the whole `InitialCanvasState` object: useCanvasLiveSync.ts
// (GAP B, live-sync on an external MCP definition edit) needs to
// replace the baseline a clean canvas is compared against AFTER a
// successful external reload, which means baseline has to live in the
// caller's own `useState` (mutable across the canvas's lifetime), not
// stay frozen inside the mount-time `initial` object.
export function useCanvasHotExit(
  tabKey: string,
  restoredFromScratch: boolean,
  baseline: ScratchDraft,
  nodes: CanvasNode[],
  edges: RFEdge[],
  notes: CanvasNoteNode[],
  draftLabel: string,
  draftDescription: string,
  // docs/goals/0022: hot-exit scratch/dirty tracking applies to EDIT
  // mode only -- a VIEW tab's content can never diverge from baseline
  // (interactions are disabled), so this is belt-and-suspenders with
  // computeInitialCanvas's own readOnly gate above, not load-bearing on
  // its own. Re-evaluated on every readOnly change (not just at mount):
  // switching view->edit via the canvas's own Edit button starts this
  // effect tracking from THAT moment forward, deliberately not
  // retroactively re-checking for a scratch that predates the switch.
  readOnly: boolean,
): void {
  const setWorkTabDirty = useAppStore((s) => s.setWorkTabDirty)
  const setWorkTabRestored = useAppStore((s) => s.setWorkTabRestored)

  useEffect(() => {
    if (readOnly) return
    if (restoredFromScratch) {
      setWorkTabRestored(tabKey, true)
      setWorkTabDirty(tabKey, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (readOnly) return
    const current = buildScratchDraft(draftLabel, draftDescription, nodes, edges, notes)
    const dirty = !draftsEqual(current, baseline)
    setWorkTabDirty(tabKey, dirty)
    if (dirty) {
      scheduleScratchWrite(tabKey, current)
    } else {
      clearScratch(tabKey)
    }
  }, [nodes, edges, notes, draftLabel, draftDescription, tabKey, baseline, setWorkTabDirty, readOnly])
}
