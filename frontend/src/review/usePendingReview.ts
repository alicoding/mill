import { useEffect } from 'react'
import { Events } from '@wailsio/runtime'
import { pendingReviewCount, refreshPendingReview, usePendingReviewStore } from './pendingReviewStore'

// The one subscription to "something waiting on you changed" (goal
// 0329 slice 2). Every surface that shows this data -- the sidebar
// badge, the Review queue, App.tsx's launch notice -- calls this hook
// and reads the store; none fetches or subscribes on its own.
//
// Three doors change the data, and all three are listened to here.
// mill-data-changed is NOT one of them: that event already has exactly
// one listener in the app (app/useDataChangedRouter.ts), which routes
// entity "run" -- the door CancelRun and ResolveApproval announce
// through -- into refreshPendingReview. A second listener for it is
// what this hook exists to prevent.
export function usePendingReview() {
  useEffect(() => {
    void refreshPendingReview()
    const offGuardrail = Events.On('guardrail-pending-changed', () => { void refreshPendingReview() })
    const offMCP = Events.On('mcp-write-approval', () => { void refreshPendingReview() })
    return () => { offGuardrail(); offMCP() }
  }, [])
  const state = usePendingReviewStore()
  return { ...state, count: pendingReviewCount(state), refresh: refreshPendingReview }
}
