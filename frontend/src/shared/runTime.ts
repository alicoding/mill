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
