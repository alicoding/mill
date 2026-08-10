import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { ExecutionService, RunKind } from '../shared/bindings'
import type { PendingApproval, RunDetail } from '../shared/bindings'

// Live run state on the authoring canvas (docs/SPEC.md §3.8's recorded
// prototype element #2): DONE/ACTIVE/PENDING per node card, a CURRENT
// STEP bar, and Approve/Deny inline on the canvas, without collapsing
// the Canvas-vs-Runs-tab split the prototype itself deferred (§3.8 says
// "collapsing Mill's canvas-vs-Runs-tab split for the in-flight case" is
// still just a recorded direction, not adopted wholesale here) -- this
// is additive to WorkflowRunsPanel.tsx, not a replacement: the Runs tab
// stays the full history/redrive surface, this is only "what's
// happening right now" surfaced where you're already looking.
//
// Deliberately never touches canvasStore (zundo-wrapped, §3.3's undo
// history) -- a 1s poll writing into an undo-tracked store would spam
// Undo with run-state noise. Run state lives here, in its own local
// React state, and reaches node cards purely via RunStateContext.
//
// Split from LiveRunControls.tsx (which keeps the components:
// CurrentStepBar, RunButton) along the same component/non-component
// seam nodeKind.ts already established, so React Fast Refresh's
// only-export-components rule holds for the .tsx half.

export type NodeRunStatus = 'done' | 'active' | 'pending' | 'failed' | 'awaiting-approval' | 'denied'

export interface RunStateContextValue {
  statusByNodeId: Record<string, NodeRunStatus>
}

export const RunStateContext = createContext<RunStateContextValue>({ statusByNodeId: {} })

function isInFlightStatus(status: string): boolean {
  return status === 'PENDING' || status === 'RUNNING' || status === 'ENQUEUED'
}

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

export type BarState =
  | { mode: 'in-flight'; activeStepLabel: string }
  | { mode: 'parked'; pending: PendingApproval }
  | { mode: 'finished'; status: string; error: string }

export interface UseLiveRunResult {
  detail: RunDetail | null
  statusByNodeId: Record<string, NodeRunStatus>
  barState: BarState | null
  startRun: (values: Record<string, string>) => void
  resolve: (nodeID: string, approve: boolean) => void
  dismiss: () => void
}

// Owns the polled run state for one open workflow editor -- a run
// started from this canvas's own Run button, or one already in flight
// (a trigger fired it while this workflow's editor was closed, and it's
// still parked/running by the time the editor opens). Mirrors
// WorkflowRunsPanel.tsx's own 1s-poll-while-in-flight pattern exactly,
// scoped to a single "the one run currently shown on this canvas"
// instead of a whole history list.
export function useLiveRun(workflowId: string | undefined): UseLiveRunResult {
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RunDetail | null>(null)

  // On mount (a workflow editor opening), adopt whatever's already in
  // flight for this workflow -- a run parked by a headless trigger fire
  // surfaces here the moment you open the editor, not just runs started
  // from this Run button.
  useEffect(() => {
    if (!workflowId) return
    let cancelled = false
    ExecutionService.ListRunsForWorkflow(workflowId)
      .then((runs) => {
        if (cancelled) return
        const newest = (runs ?? [])[0]
        if (newest && (isInFlightStatus(newest.status) || newest.pending != null)) {
          setActiveRunId(newest.runID)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [workflowId])

  // Fetch the full step breakdown whenever the displayed run changes --
  // covers both startRun's own resolve and the mount-time adopt above,
  // one place instead of two copies of the same GetRun call.
  useEffect(() => {
    if (!activeRunId) {
      setDetail(null)
      return
    }
    ExecutionService.GetRun(activeRunId).then(setDetail).catch(() => {})
  }, [activeRunId])

  // While the displayed run is still in flight (running, or parked
  // awaiting approval), poll it -- identical shape to
  // WorkflowRunsPanel.tsx's own in-flight poll, so a resolve/deny here
  // and there never disagree on when to stop polling.
  useEffect(() => {
    if (!activeRunId || !detail) return
    const inFlight = isInFlightStatus(detail.status) || detail.pending != null
    if (!inFlight) return
    const timer = setInterval(() => {
      ExecutionService.GetRun(activeRunId).then(setDetail).catch(() => {})
    }, 1000)
    return () => clearInterval(timer)
    // Deliberately keyed on detail?.status/detail?.pending, not the
    // whole `detail` object -- matches WorkflowRunsPanel.tsx's own
    // identical poll effect, which the linter can't verify soundness of
    // through optional chaining either.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunId, detail?.status, detail?.pending])

  const startRun = (values: Record<string, string>) => {
    if (!workflowId) return
    // Hides any stale finished/parked bar from a previous run while the
    // new one starts -- RunWorkflow blocks until completion or park, so
    // there's a real (if usually short) window with nothing to show yet.
    setDetail(null)
    ExecutionService.RunWorkflow(workflowId, RunKind.RunKindTest, values)
      .then((summary) => setActiveRunId(summary.runID))
      .catch((err) => console.error(err))
  }

  const resolve = (nodeID: string, approve: boolean) => {
    if (!activeRunId) return
    ExecutionService.ResolveApproval(activeRunId, nodeID, approve, {}).catch((err) => console.error(err))
    // The in-flight poll above picks up the resumed/failed transition.
  }

  const dismiss = () => {
    setActiveRunId(null)
    setDetail(null)
  }

  // DBOS checkpoints a step only once it completes, so there's no
  // native "currently executing" status to read -- the first step still
  // 'pending' in declaration order, while the run itself is in flight,
  // is the honest currently-executing approximation.
  const statusByNodeId = useMemo(() => {
    const result: Record<string, NodeRunStatus> = {}
    if (!detail) return result
    const steps = detail.steps ?? []
    const inFlight = isInFlightStatus(detail.status) || detail.pending != null
    let activeAssigned = false
    for (const step of steps) {
      let status: NodeRunStatus
      switch (step.status) {
        case 'succeeded':
          status = 'done'
          break
        case 'failed':
          status = 'failed'
          break
        case 'awaiting-approval':
          status = 'awaiting-approval'
          break
        case 'denied':
          status = 'denied'
          break
        default:
          status = 'pending'
      }
      if (inFlight && status === 'pending' && !activeAssigned) {
        status = 'active'
        activeAssigned = true
      }
      result[step.nodeID] = status
    }
    return result
  }, [detail])

  const barState = useMemo<BarState | null>(() => {
    if (!detail) return null
    if (detail.pending) return { mode: 'parked', pending: detail.pending }
    if (isInFlightStatus(detail.status)) {
      const steps = detail.steps ?? []
      const active = steps.find((s) => s.status === 'pending')
      return { mode: 'in-flight', activeStepLabel: active ? active.nodeTypeLabel || active.nodeTypeID : 'Running…' }
    }
    return { mode: 'finished', status: detail.status, error: detail.error }
  }, [detail])

  return { detail, statusByNodeId, barState, startRun, resolve, dismiss }
}

// Convenience hook so CanvasNodeView only needs one import.
export function useNodeRunStatus(nodeId: string): NodeRunStatus | undefined {
  return useContext(RunStateContext).statusByNodeId[nodeId]
}
