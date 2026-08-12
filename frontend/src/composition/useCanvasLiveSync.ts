import { useEffect, useRef, useState } from 'react'
import { Events } from '@wailsio/runtime'
import type { NodeType, Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { CompositionService } from '../shared/bindings'
import type { CanvasStore } from './canvasStore'
import { toCanvasNodes, toRFEdges } from './canvasConversion'
import { buildScratchDraft, draftsEqual, type ScratchDraft } from './canvasScratch'

// GAP B of the live-canvas-sync work (docs/SPEC.md §1's realtime lock,
// applied to authoring): an open workflow editor reacting to an
// external MCP definition edit (millmcpservice_authoring.go's
// update_workflow/publish_workflow, both emit `mill-data-changed`
// {entity:'workflow', id}), not just App.tsx's own coarse store
// refresh (App.tsx:229), which never reaches the mounted canvas's own
// nodes/edges/undo history.
//
// Split out of CompositionCanvas.tsx (already at the 500-line limit,
// CLAUDE.md) rather than inlined, same seam useCanvasHotExit.ts already
// established for hot exit's own client-side logic.

export interface PendingExternalWorkflowChange {
  workflow: Workflow
}

interface UseCanvasLiveSyncArgs {
  workflowId: string | undefined
  nodeTypes: NodeType[]
  useCanvasStore: CanvasStore
  baseline: ScratchDraft
  setBaseline: (baseline: ScratchDraft) => void
  draftLabel: string
  draftDescription: string
  setDraftLabel: (label: string) => void
  setDraftDescription: (description: string) => void
}

export interface UseCanvasLiveSyncResult {
  // Non-null exactly while a dismissible banner should show -- the
  // canvas had unsaved edits when the external change arrived, so it
  // was NOT applied automatically.
  pendingExternalChange: PendingExternalWorkflowChange | null
  reloadFromExternal: () => void
  keepDraft: () => void
}

// Pure decision point, exported for testing: does an external
// definition apply immediately, or does it need the user's say-so?
// "Clean" means the live draft is structurally identical (canvasScratch's
// own id-agnostic draftsEqual) to what this canvas last loaded/saved --
// exactly the same notion of "dirty" useCanvasHotExit already tracks,
// reused rather than re-invented.
export function decideExternalSyncAction(currentDraft: ScratchDraft, baseline: ScratchDraft): 'apply' | 'prompt' {
  return draftsEqual(currentDraft, baseline) ? 'apply' : 'prompt'
}

// Replaces the canvas's nodes/edges/label/description/baseline with a
// freshly-fetched Workflow, and resets the undo stack -- shared by the
// automatic clean-canvas path and the explicit "Reload" banner action,
// so there is exactly one place that resets all five together. Undo
// history is cleared (not just left alone): a stale zundo history would
// let Undo step back into the pre-external-change state, which reads as
// Mill silently reverting someone else's already-applied change.
function applyExternalWorkflow(
  workflow: Workflow,
  nodeTypes: NodeType[],
  useCanvasStore: CanvasStore,
  setBaseline: (b: ScratchDraft) => void,
  setDraftLabel: (v: string) => void,
  setDraftDescription: (v: string) => void,
): void {
  const freshNodes = toCanvasNodes(workflow.Nodes, nodeTypes)
  const freshEdges = toRFEdges(workflow.Edges)
  useCanvasStore.getState().load(freshNodes, freshEdges)
  useCanvasStore.temporal.getState().clear()
  setBaseline(buildScratchDraft(workflow.Label, workflow.Description, freshNodes, freshEdges))
  setDraftLabel(workflow.Label)
  setDraftDescription(workflow.Description)
}

export function useCanvasLiveSync(args: UseCanvasLiveSyncArgs): UseCanvasLiveSyncResult {
  const { workflowId, nodeTypes, useCanvasStore, baseline, setBaseline, draftLabel, draftDescription, setDraftLabel, setDraftDescription } = args
  const [pendingExternalChange, setPendingExternalChange] = useState<PendingExternalWorkflowChange | null>(null)

  // The Events.On callback below closes over whatever these refs hold
  // at the moment the event fires -- nodes/edges don't need this
  // (useCanvasStore.getState() always reads current state), but
  // baseline/draftLabel/draftDescription live in plain React state one
  // level up and would otherwise be captured stale by a subscription
  // that (deliberately) only re-attaches when workflowId itself changes.
  const baselineRef = useRef(baseline)
  useEffect(() => {
    baselineRef.current = baseline
  }, [baseline])
  const draftLabelRef = useRef(draftLabel)
  useEffect(() => {
    draftLabelRef.current = draftLabel
  }, [draftLabel])
  const draftDescriptionRef = useRef(draftDescription)
  useEffect(() => {
    draftDescriptionRef.current = draftDescription
  }, [draftDescription])

  // Real bug found via CI flake investigation (docs/goals/BACKLOG.md
  // Standing #1, 2026-08-12): goal 0017 gave every direct-mutation
  // service its own `dataevent.Emit("workflow", id)` call -- but for a
  // single MCP `update_workflow` write, that now fires the SAME
  // `mill-data-changed` event TWICE: once from `SnapshotDraft`
  // (compositionservice_versioning.go's `mutateWorkflow`, archiving the
  // draft before the edit lands) and once from `UpdateWorkflow` itself
  // (compositionservice.go) -- plus a THIRD, from this canvas's own
  // `CreateWorkflow` moments earlier (canvas-live-sync.spec.ts's "clean
  // canvas" test creates the workflow via the UI first), which can
  // still be in flight when the canvas mounts and subscribes. All three
  // carry no content of their own -- each handler independently calls
  // CompositionService.Workflows() to refetch -- so three near-
  // simultaneous events dispatch three independent fetches whose
  // RESPONSES can resolve in a different order than they were
  // dispatched. Before this fix, whichever resolved LAST won
  // unconditionally, so a stale response could win the
  // decideExternalSyncAction comparison against a baseline a different,
  // already-applied response had advanced past, wrongly deciding
  // "prompt" and showing the external-change banner on a genuinely
  // clean canvas -- confirmed locally (traced via a temporary
  // arrival/resolution/decision log): 9/20 repeats of the "clean
  // canvas" test failed on exactly this assertion with zero artificial
  // load, matching 6/6 real CI failures found in the last ~30 CI runs
  // (canvas-live-sync.spec.ts:151, all after goal 0017 merged, zero
  // occurrences before). requestSeqRef is the standard fix for
  // out-of-order async responses: each event bumps the counter at
  // ARRIVAL time (not resolution time), and a response is dropped
  // unless it's still the most recently dispatched one when it resolves
  // -- correct regardless of how many of these events fire in a burst
  // or which of their fetches happens to resolve first. Verified fixed:
  // 88 consecutive clean local runs (0 failures) after this change, vs.
  // 9/20 before it, same build.
  const requestSeqRef = useRef(0)

  useEffect(() => {
    if (!workflowId) return
    return Events.On('mill-data-changed', (evt) => {
      const data = evt.data as { entity?: string; id?: string }
      if (data?.entity !== 'workflow' || data?.id !== workflowId) return
      const seq = ++requestSeqRef.current
      CompositionService.Workflows()
        .then((all) => {
          // A newer mill-data-changed event for this same workflow has
          // already arrived and dispatched its own fetch since this one
          // started -- this response is now stale (see the header
          // comment above); applying or even just deciding on it would
          // race the newer one. Drop it.
          if (seq !== requestSeqRef.current) return
          const fresh = (all ?? []).find((wf) => wf.ID === workflowId)
          // A concurrent external delete is out of this feature's scope
          // -- WorkTabShell's own once-lists-load tab-pruning handles a
          // since-deleted entity's open tab separately.
          if (!fresh) return
          const { nodes: storeNodes, edges: storeEdges } = useCanvasStore.getState()
          const currentDraft = buildScratchDraft(draftLabelRef.current, draftDescriptionRef.current, storeNodes, storeEdges)
          if (decideExternalSyncAction(currentDraft, baselineRef.current) === 'apply') {
            applyExternalWorkflow(fresh, nodeTypes, useCanvasStore, setBaseline, setDraftLabel, setDraftDescription)
          } else {
            setPendingExternalChange({ workflow: fresh })
          }
        })
        .catch(() => {})
    })
  }, [workflowId, nodeTypes, useCanvasStore, setBaseline, setDraftLabel, setDraftDescription])

  const reloadFromExternal = () => {
    if (!pendingExternalChange) return
    applyExternalWorkflow(pendingExternalChange.workflow, nodeTypes, useCanvasStore, setBaseline, setDraftLabel, setDraftDescription)
    setPendingExternalChange(null)
  }

  const keepDraft = () => setPendingExternalChange(null)

  return { pendingExternalChange, reloadFromExternal, keepDraft }
}
