import type { RunSummary } from '../../bindings/github.com/alicoding/mill/internal/services/executionsvc/models'

// The tray panel's Running-section split (docs/goals/0189): an
// in-flight run per the engine's own predicate
// (executionservice_summary.go's PENDING/RUNNING/ENQUEUED), minus
// parked-awaiting-approval runs, which belong in the Needs-you
// section instead. Its own pure module (type-only bindings import) so
// the unit test never evaluates the runtime-bound panel component --
// holding a real run in-flight is a structural harness gap, so this
// split is proven here while the rendered sections are e2e-proven
// with the states the harness CAN produce.
const IN_FLIGHT = new Set(['PENDING', 'RUNNING', 'ENQUEUED'])

export function runningRuns(runs: RunSummary[]): RunSummary[] {
  return runs.filter((r) => !r.pending && IN_FLIGHT.has(r.status))
}
