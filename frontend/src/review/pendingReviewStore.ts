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
  // Runs currently parked on an approval, newest-first as ListRuns
  // returns them. A run reconciled after a relaunch has no pending
  // approval and so never appears here.
  pending: RunSummary[]
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
  resolved: [],
  pendingWrites: [],
  revision: 0,
  loaded: false,
}))

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
      pending: runs.filter((r) => r.pending),
      resolved: runs.filter((r) => r.resolution),
      pendingWrites,
      revision: prev.revision + 1,
      loaded: true,
    }))
  })
}
