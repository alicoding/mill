import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Events } from '@wailsio/runtime'
import { ExecutionService, RunKind } from '../shared/bindings'
import { useApprovalResolution } from '../shared/approvalResolution'
import type { PendingApproval, RunDetail } from '../shared/bindings'
import { VAULT_LOCKED_REASON } from '../shared/parkReason'
import { background } from '../shared/background'

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
  // The node the displayed run is parked on right now, empty when it is
  // not parked. The status map alone cannot answer this: a run can carry
  // several awaiting-approval steps across its history, and only one of
  // them is where the run is actually stopped (goal 0328).
  pausedNodeId: string
}

export const RunStateContext = createContext<RunStateContextValue>({ statusByNodeId: {}, pausedNodeId: '' })

function isInFlightStatus(status: string): boolean {
  return status === 'PENDING' || status === 'RUNNING' || status === 'ENQUEUED'
}

// GAP A of the live-canvas-sync work (docs/SPEC.md §1's realtime lock):
// should a newly-adopted run replace what this canvas currently
// displays? Pure and exported for testing -- the actual decision is
// small enough that getting it wrong silently (yanking the display away
// from a run the user is watching) would be an easy, hard-to-notice
// regression. `false` (an already-displayed run keeps priority) only
// when a run is currently shown AND it's still in flight -- a finished
// run (or nothing shown at all) always yields to whatever's newest.
export function shouldAdoptExternalRun(hasActiveRun: boolean, activeRunInFlight: boolean): boolean {
  return !hasActiveRun || !activeRunInFlight
}

// Which bar the canvas shows for the run currently displayed. Pure and
// exported for testing, same reasoning as shouldAdoptExternalRun above:
// the ordering carries a real decision -- an interrupted run is checked
// BEFORE pending, because a run reconciled at startup still has the
// durable pending event its park wrote, and offering Resume on it is
// exactly the dead button this ordering removes.
export function barStateFor(detail: RunDetail | null, startRefusal: string): BarState | null {
  if (startRefusal) return { mode: 'finished', status: 'REFUSED', error: startRefusal }
  if (!detail) return null
  if (detail.interrupted) return { mode: 'interrupted' }
  if (detail.pending) return { mode: 'parked', pending: detail.pending }
  if (isInFlightStatus(detail.status)) {
    const steps = detail.steps ?? []
    const active = steps.find((s) => s.status === 'pending')
    return { mode: 'in-flight', activeStepLabel: active ? active.nodeTypeLabel || active.nodeTypeID : 'Running…' }
  }
  return { mode: 'finished', status: detail.status, error: detail.error }
}

// Which controls a park offers. A stepped run can advance one node at a
// time OR run straight to the end; a plain breakpoint has nowhere to
// step to, so it offers the single resume action only. Pure and
// exported: the ordering and the omission are the decision worth
// pinning down, and both are invisible in a rendered tree.
export type ParkControl = 'continue' | 'step' | 'stop' | 'approve' | 'deny' | 'unlock'

// A vault wait (shared/parkReason.ts) offers the unlock and the stop:
// there is no decision to approve.
export function parkControls(source: string, stepped: boolean, reason = ''): ParkControl[] {
  if (reason === VAULT_LOCKED_REASON) return ['unlock', 'stop']
  if (source !== 'debug') return ['approve', 'deny']
  return stepped ? ['continue', 'step', 'stop'] : ['continue', 'stop']
}

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

export type BarState =
  | { mode: 'in-flight'; activeStepLabel: string }
  | { mode: 'parked'; pending: PendingApproval }
  // A run that was waiting on a person when Mill relaunched under a
  // different workflow-code version: the engine can never pick it back
  // up, so the bar states that and offers only Dismiss -- never Resume
  // or Stop, which would answer nothing (goal 0329).
  | { mode: 'interrupted' }
  | { mode: 'finished'; status: string; error: string }


export interface UseLiveRunResult {
  detail: RunDetail | null
  statusByNodeId: Record<string, NodeRunStatus>
  // The parked node, empty when the displayed run is not parked.
  pausedNodeId: string
  barState: BarState | null
  // stepped starts a debug "step mode" run (docs/adr/0031 §5) instead
  // of a plain test run -- it parks before every node, not just
  // external-effect ones.
  startRun: (values: Record<string, string>, stepped?: boolean, payload?: string) => void
  // continueRun only matters for a stepped run's park (docs/adr/0031
  // §5): false is the "Step" control (keeps step mode on, the NEXT node
  // parks again too), true is "Resume"/"Continue" (clears it, the run
  // finishes straight through). Meaningless -- and harmless -- for a
  // plain breakpoint or policy ask. values is the edit-and-resume typed
  // input (item 4), discarded on a deny/stop.
  resolve: (nodeID: string, approve: boolean, continueRun?: boolean, values?: Record<string, string>) => void
  // The i18n key for the last resolve refusal, empty when the last
  // decision landed. Rendered inline in the parked bar.
  resolveErrorKey: string
  dismiss: () => void
}

// Owns the polled run state for one open workflow editor -- a run
// started from this canvas's own Run button, or one already in flight
// (a trigger fired it while this workflow's editor was closed, and it's
// still parked/running by the time the editor opens). Mirrors
// WorkflowRunsPanel.tsx's own 1s-poll-while-in-flight pattern exactly,
// scoped to a single "the one run currently shown on this canvas"
// instead of a whole history list.
// requestedRunId (goal 0294): a run this canvas was opened to show --
// an exact run id, or 'latest' for the workflow's newest run in any
// state (a run that already finished still gets its per-node marks and
// the finished bar). Without it, only an in-flight run is adopted.
export function useLiveRun(workflowId: string | undefined, requestedRunId?: string): UseLiveRunResult {
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  useEffect(() => {
    if (!workflowId || !requestedRunId) return
    if (requestedRunId !== 'latest') {
      setActiveRunId(requestedRunId)
      return
    }
    let cancelled = false
    void background(ExecutionService.ListRunsForWorkflow(workflowId)
      .then((runs) => {
        const newest = (runs ?? [])[0]
        if (!cancelled && newest) setActiveRunId(newest.runID)
      }), 'liveRunState.adoptRequestedLatest')
    return () => {
      cancelled = true
    }
  }, [workflowId, requestedRunId])
  const [detail, setDetail] = useState<RunDetail | null>(null)
  // A rejected START (pre-flight refusal) -- distinct from a run that
  // ran and failed; rendered through the same finished bar.
  const [startRefusal, setStartRefusal] = useState('')
  // The shared answer-a-parked-run seam (shared/approvalResolution.ts),
  // the same one the Runs panel and the Review queue use.
  const { errorKeyFor, clearError, resolveApproval } = useApprovalResolution()

  // On mount (a workflow editor opening), adopt whatever's already in
  // flight for this workflow -- a run parked by a headless trigger fire
  // surfaces here the moment you open the editor, not just runs started
  // from this Run button.
  useEffect(() => {
    if (!workflowId) return
    let cancelled = false
    void background(ExecutionService.ListRunsForWorkflow(workflowId)
      .then((runs) => {
        if (cancelled) return
        const newest = (runs ?? [])[0]
        if (newest && (isInFlightStatus(newest.status) || newest.pending != null)) {
          setActiveRunId(newest.runID)
        }
      }), 'liveRunState.adoptOnMount')
    return () => {
      cancelled = true
    }
  }, [workflowId])

  // GAP A: adopt a run started externally (an MCP run_workflow/debug
  // tool call, millmcpservice_debug.go/millmcpservice_authoring.go --
  // both emit `mill-data-changed` {entity:'run'}) while this editor
  // stays open, not just on mount. Mirrors the mount-time adopt above
  // (newest in-flight/pending run for this workflow), gated by
  // shouldAdoptExternalRun so an already-in-flight run this user is
  // watching never gets silently swapped out from under them.
  useEffect(() => {
    if (!workflowId) return
    const hasActiveRun = activeRunId !== null
    const activeInFlight = hasActiveRun && (isInFlightStatus(detail?.status ?? '') || detail?.pending != null)
    if (!shouldAdoptExternalRun(hasActiveRun, activeInFlight)) return
    return Events.On('mill-data-changed', (evt) => {
      const data = evt.data as { entity?: string }
      if (data?.entity !== 'run') return
      void background(ExecutionService.ListRunsForWorkflow(workflowId)
        .then((runs) => {
          const newest = (runs ?? [])[0]
          if (newest && (isInFlightStatus(newest.status) || newest.pending != null)) {
            setActiveRunId(newest.runID)
          }
        }), 'liveRunState.adoptExternalRun')
    })
    // Keyed on detail?.status/detail?.pending, not the whole `detail`
    // object -- same reasoning as the in-flight poll effect below (only
    // a real status/pending transition should re-evaluate whether
    // adoption is currently allowed, not every poll tick).
  }, [workflowId, activeRunId, detail?.status, detail?.pending])

  // Fetch the full step breakdown whenever the displayed run changes --
  // covers both startRun's own resolve and the mount-time adopt above,
  // one place instead of two copies of the same GetRun call.
  useEffect(() => {
    if (!activeRunId) {
      setDetail(null)
      return
    }
    void background(ExecutionService.GetRun(activeRunId).then(setDetail), 'liveRunState.getRun')
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
      void background(ExecutionService.GetRun(activeRunId).then(setDetail), 'liveRunState.getRun')
    }, 1000)
    return () => clearInterval(timer)
    // Deliberately keyed on detail?.status/detail?.pending, not the
    // whole `detail` object -- matches WorkflowRunsPanel.tsx's own
    // identical poll effect, which the linter can't verify soundness of
    // through optional chaining either.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunId, detail?.status, detail?.pending])

  const startRun = (values: Record<string, string>, stepped?: boolean, payload?: string) => {
    if (!workflowId) return
    // Hides any stale finished/parked bar from a previous run while the
    // new one starts -- RunWorkflow blocks until completion or park, so
    // there's a real (if usually short) window with nothing to show yet.
    setDetail(null)
    setStartRefusal('')
    clearError()
    // payload substitutes what the workflow's trigger would have
    // delivered (triggerPayload.ts) -- threaded to both run variants,
    // since a stepped debug run of a trigger-fed workflow needs its
    // input exactly as much as a plain test run does.
    const call = stepped
      ? ExecutionService.RunWorkflowStepped(workflowId, values, payload ?? '')
      : payload
        ? ExecutionService.RunWorkflowWithPayload(workflowId, RunKind.RunKindTest, values, payload)
        : ExecutionService.RunWorkflow(workflowId, RunKind.RunKindTest, values)
    // A REJECTED start (the run pre-flight's refusal, an unknown
    // workflow) is user-facing state, never console noise -- the
    // refusal renders in the same bar a failed run uses.
    call.then((summary) => setActiveRunId(summary.runID)).catch((err) => setStartRefusal(String(err)))
  }

  const resolve = (nodeID: string, approve: boolean, continueRun?: boolean, values?: Record<string, string>) => {
    if (!activeRunId) return
    void resolveApproval({ runID: activeRunId, nodeID, approve, values, continueRun }).then((delivered) => {
      // A refused decision means the bar is showing something stale --
      // refetch so it stops offering what it just failed to do.
      if (!delivered) void background(ExecutionService.GetRun(activeRunId).then(setDetail), 'liveRunState.getRun')
    })
    // The in-flight poll above picks up the resumed/failed transition.
  }

  const dismiss = () => {
    setActiveRunId(null)
    setDetail(null)
    setStartRefusal('')
    clearError()
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

  const barState = useMemo<BarState | null>(() => barStateFor(detail, startRefusal), [detail, startRefusal])

  return { detail, statusByNodeId, pausedNodeId: detail?.pending?.nodeID ?? '', barState, startRun, resolve, resolveErrorKey: activeRunId ? errorKeyFor(activeRunId) : '', dismiss }
}

// Convenience hook so CanvasNodeView only needs one import.
export function useNodeRunStatus(nodeId: string): NodeRunStatus | undefined {
  return useContext(RunStateContext).statusByNodeId[nodeId]
}

// Whether the displayed run is parked on THIS node -- what the canvas
// card draws its accent ring from.
export function useNodePaused(nodeId: string): boolean {
  return useContext(RunStateContext).pausedNodeId === nodeId
}
