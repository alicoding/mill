import type { RunSummary } from './bindings'
import { ageTier } from './staleness'

// Stuck-ENQUEUED presentation (docs/goals/0026 item 8): a real
// zombie ENQUEUED run (a queued-forever workflow that never got
// dequeued) was found in production data, reading as live when it was
// never going to progress. Shared by WorkflowRunsPanel and Activity's
// runs explorer -- one definition of "stuck," not two.
export const ENQUEUED_STALE_THRESHOLD_MS = 5 * 60 * 1000

// isStuckEnqueued is true only for a run that's BOTH still ENQUEUED
// (never even started) AND older than the 5-minute bar -- a run that's
// pending on a guardrail approval already has its own distinct
// presentation (isDebugPark/isHumanReview et al.), so this
// deliberately excludes anything with `pending` set even if DBOS
// happens to report ENQUEUED underneath it.
export function isStuckEnqueued(run: Pick<RunSummary, 'status' | 'pending' | 'startedAt'>, now: number = Date.now()): boolean {
  if (run.status !== 'ENQUEUED' || run.pending) return false
  return ageTier(run.startedAt, now, ENQUEUED_STALE_THRESHOLD_MS) === 'aging'
}
