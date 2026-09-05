import { create } from 'zustand'
import { ExecutionService, SettingsService } from '../shared/bindings'
import type { MCPWriteRequest, RunSummary } from '../shared/bindings'

// One source of "what is waiting on you" (goal 0329 slice 2). Three
// surfaces render this same data -- the sidebar's Review badge, the
// Review queue, and App.tsx's launch notice -- and each used to fetch
// it and subscribe to events on its own. The badge subscribed to
// guardrail-pending-changed and mcp-write-approval but not to the
// shared mill-data-changed, so a run stopped from the run detail
// (CancelRun) left the badge counting a review nobody could answer;
// Review only looked right because it also polled every 2 seconds.
//
// The shape mirrors shared/store.ts and shared/configureEntityStore.ts
// exactly: a zustand store plus one refresh function, called from every
// door that changes the data -- including App.tsx's ONE
// mill-data-changed router (useDataChangedRouter.ts), never a second
// listener for that event.

interface PendingReviewState {
  // Runs currently parked on an approval a PERSON has to answer,
  // newest-first as ListRuns returns them. A run reconciled after a
  // relaunch has no pending approval and so never appears here, and
  // neither does a debug park (see pausedDebug below).
  pending: RunSummary[]
  // Runs paused by step mode or a breakpoint (goal 0328). These are a
  // STATE of the run, not a decision anyone is being asked for, so they
  // are deliberately outside `pending`: Review is where a person answers
  // something, and a step-mode pause answers to whoever started it,
  // from the canvas or from Activity. Kept here rather than dropped
  // because the editor's close guard needs to know one exists.
  pausedDebug: RunSummary[]
  // Runs that once parked and have since been resolved -- the Review
  // queue's recently-resolved section reads this, and it comes from the
  // same ListRuns call, so it is never a second fetch.
  resolved: RunSummary[]
  pendingWrites: MCPWriteRequest[]
  // Bumped on every completed refresh. A surface with extra data of its
  // own (Review's resolved MCP writes) keys an effect on this instead
  // of subscribing to the same events again.
  revision: number
  loaded: boolean
}

export const usePendingReviewStore = create<PendingReviewState>(() => ({
  pending: [],
  pausedDebug: [],
  resolved: [],
  pendingWrites: [],
  revision: 0,
  loaded: false,
}))

// Whether a parked run belongs in Review at all (goal 0328). A debug
// park -- step mode or a breakpoint -- is the person who started the run
// pausing their own run; nobody is being asked to decide anything, so it
// never reaches the queue, the sidebar badge, or the launch notice.
// Pure and exported: this one predicate is what keeps the badge count
// and the queue from disagreeing about what "waiting on you" means.
export function isReviewablePark(run: Pick<RunSummary, 'pending'>): boolean {
  return Boolean(run.pending) && run.pending?.source !== 'debug'
}

// The count the sidebar badge shows and NotifyPendingApproval is called
// with: parked runs plus pending agent writes, the two things a person
// can answer from Review.
export function pendingReviewCount(state: Pick<PendingReviewState, 'pending' | 'pendingWrites'>): number {
  return state.pending.length + state.pendingWrites.length
}

export function refreshPendingReview(): Promise<void> {
  return Promise.all([
    ExecutionService.ListRuns().then((runs) => runs ?? []).catch(() => [] as RunSummary[]),
    SettingsService.PendingMCPWrites().then((writes) => writes ?? []).catch(() => [] as MCPWriteRequest[]),
  ]).then(([runs, pendingWrites]) => {
    usePendingReviewStore.setState((prev) => ({
      pending: runs.filter((r) => isReviewablePark(r)),
      pausedDebug: runs.filter((r) => r.pending?.source === 'debug'),
      resolved: runs.filter((r) => r.resolution),
      pendingWrites,
      revision: prev.revision + 1,
      loaded: true,
    }))
  })
}
