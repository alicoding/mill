import type { StatusStampVariant } from './StatusStamp'

// Formats a run's startedAt for display, guarding defensively against
// Go's zero time ("0001-01-01T00:00:00Z") ever reaching the UI as a
// formatted date (docs/goals/0002-review-queue-maturation.md item 5 --
// the reported "1-12-31, 6:42:28 PM" bug). The root cause is fixed
// server-side: executionservice.go's summaryFromStatus now falls back
// to the run's CreatedAt when DBOS's own StartedAt is zero (DBOS only
// populates StartedAt for workflows dequeued off a Queue -- Mill runs
// execute directly, never via one, so it was unconditionally zero for
// every run). This stays as a defensive display-layer guard, not the
// primary fix -- shared by every surface that renders a run's started
// time (ReviewView, WorkflowRunsPanel, ActivityRunsExplorer) so a
// future regression in the server-side fallback still can't render a
// year-1 date.
export function formatRunStartedAt(startedAt: string): string {
  const d = new Date(startedAt)
  if (isNaN(d.getTime()) || d.getTime() < 0) return '—'
  return d.toLocaleString()
}

// DBOS's own WorkflowStatusType values (dbos-transact-golang's
// internal/models/workflow_status.go), decoded by executionservice.go's
// summaryFromStatus straight through as RunSummary.Status -- the run
// terminal/in-flight vocabulary every surface rendering a run's status
// badge maps to a StatusStampVariant from. Shared so a second
// independent copy of this mapping (Atlas's card overlay, goal 0061
// slice C) can't quietly drift from WorkflowRunsPanel.tsx's original.
const RUN_STATUS_VARIANT: Record<string, StatusStampVariant> = {
  SUCCESS: 'success',
  ERROR: 'danger',
  PENDING: 'caution',
  ENQUEUED: 'caution',
  CANCELLED: 'neutral',
  MAX_RECOVERY_ATTEMPTS_EXCEEDED: 'danger',
}

export function runStatusVariant(status: string): StatusStampVariant {
  return RUN_STATUS_VARIANT[status] ?? 'neutral'
}

// One run-status label for every surface that shows one. A run the
// engine could never pick back up after a relaunch reads as its own
// state rather than the bare CANCELLED it shares with a run a person
// stopped -- "was stopped" and "nobody could answer" are different
// facts (goal 0329). Every other status keeps rendering DBOS's own
// token, which is what these surfaces have always shown. The `common`
// namespace so the three callers (runs list, Activity, Review) each
// pass their own `t` without three copies of the string.
export function runStatusLabel(
  run: { status: string; interrupted?: boolean; pending?: { source?: string } | null },
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (run.interrupted) return t('runStatus.interrupted', { ns: 'common' })
  if (isPausedRun(run)) return t('runStatus.paused', { ns: 'common' })
  return run.status
}

// A run stopped by step mode or a breakpoint (goal 0328). DBOS reports
// it as PENDING like any other in-flight run, so the park is the only
// thing that distinguishes "still working" from "waiting for you to say
// go" -- and it is a STATUS on the runs list, never an approval.
export function isPausedRun(run: { pending?: { source?: string } | null }): boolean {
  return run.pending?.source === 'debug'
}
