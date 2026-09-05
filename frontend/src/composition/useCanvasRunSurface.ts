import { useEffect, useMemo } from 'react'
import { useReactFlow } from '@xyflow/react'
import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { useLiveRun, type NodeRunStatus, type RunStateContextValue, type UseLiveRunResult } from './liveRunState'
import { useSteppedRunGuard, type SteppedRunGuard } from './useSteppedRunGuard'

// Everything the canvas needs about the run it is currently showing,
// gathered in one place: the polled state, the per-node marks the cards
// read, the guard that keeps a workflow from having two paused stepped
// runs at once, and following a pause into view. Split out of
// CompositionCanvas.tsx at the 500-line limit (.claude/rules/architecture.md),
// along the seam every other useCanvas* hook there already follows.

// A Trigger node never checkpoints a step of its own, so GetRun's steps
// carry no signal for it at all. It fired by definition the moment any
// run exists, so it is marked done rather than left blank. Pure and
// exported: what a node card shows for a step the engine never records
// is a real decision, and one no rendered tree makes visible.
export function withTriggersDone(
  statusByNodeId: Record<string, NodeRunStatus>,
  nodes: { id: string; data: { kind: string } }[],
  hasRun: boolean,
): Record<string, NodeRunStatus> {
  if (!hasRun) return statusByNodeId
  const merged = { ...statusByNodeId }
  for (const node of nodes) {
    if (node.data.kind === 'trigger') merged[node.id] = 'done'
  }
  return merged
}

export interface CanvasRunSurface extends UseLiveRunResult {
  runStateContextValue: RunStateContextValue
  steppedGuard: SteppedRunGuard
}

export function useCanvasRunSurface(
  workflow: Workflow | null | undefined,
  requestedRunId: string | undefined,
  nodes: { id: string; data: { kind: string } }[],
): CanvasRunSurface {
  // Never touches useCanvasStore (zundo-wrapped undo history, SPEC §3.3)
  // -- see liveRunState.ts's own header comment.
  const live = useLiveRun(workflow?.ID, requestedRunId)
  const { detail, statusByNodeId: liveStatusByNodeId, pausedNodeId, startRun } = live
  const statusByNodeId = useMemo(
    () => withTriggersDone(liveStatusByNodeId, nodes, detail !== null),
    [liveStatusByNodeId, detail, nodes],
  )
  const runStateContextValue = useMemo(() => ({ statusByNodeId, pausedNodeId }), [statusByNodeId, pausedNodeId])
  const steppedGuard = useSteppedRunGuard(workflow?.ID, startRun)

  // A pause is only useful if you can see where it happened (goal 0328):
  // when a run parks, bring that node into view. Keyed on the parked
  // node alone, so stepping through a graph follows the run and a poll
  // tick that changes nothing never yanks the viewport.
  //
  // The top padding clears the dock, which is itself anchored to the top
  // of this board: centering the parked node would park it directly
  // under the toolbar naming it. Its value is the dock's own worst-case
  // height (label, the edit-and-resume form, the button row).
  const { fitView } = useReactFlow()
  useEffect(() => {
    if (!pausedNodeId) return
    void fitView({
      nodes: [{ id: pausedNodeId }],
      maxZoom: 1,
      padding: { top: '200px', right: '20%', bottom: '20%', left: '20%' },
      duration: 300,
    })
  }, [pausedNodeId, fitView])

  return { ...live, statusByNodeId, runStateContextValue, steppedGuard }
}
