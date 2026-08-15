import { useEffect, useState } from 'react'
import { ExecutionService } from '../shared/bindings'
import type { RunDetail } from '../shared/bindings'

export interface UseLatestRunDetailResult {
  detail: RunDetail | null
  // True only while the initial fetch is in flight -- lets a caller
  // distinguish "still finding out" from "confirmed no run yet" (both
  // render as detail === null otherwise).
  loading: boolean
}

// The step-detail overlay's own data source (docs/goals/0058 item 4):
// the workflow's LATEST recorded run regardless of status, independent
// of liveRunState.ts's useLiveRun (which only auto-adopts a run still
// in flight at mount time -- a deliberate choice there so a finished
// run never silently replaces what the canvas is showing, see its own
// header comment). ListRunsForWorkflow already returns most-recent-
// first (executionservice.ts's own doc comment), so the newest entry is
// exactly "last recorded run" -- mirrors WorkflowRunsPanel.tsx's own
// list-then-GetRun sequence, scoped to just the newest run instead of
// the full history table.
export function useLatestRunDetail(workflowId: string | undefined, enabled: boolean): UseLatestRunDetailResult {
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!workflowId || !enabled) return
    let cancelled = false
    setLoading(true)
    ExecutionService.ListRunsForWorkflow(workflowId)
      .then((runs) => {
        const newest = (runs ?? [])[0]
        if (!newest) return null
        return ExecutionService.GetRun(newest.runID)
      })
      .then((result) => {
        if (cancelled) return
        setDetail(result ?? null)
      })
      .catch(() => {
        if (!cancelled) setDetail(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workflowId, enabled])

  return { detail, loading }
}
