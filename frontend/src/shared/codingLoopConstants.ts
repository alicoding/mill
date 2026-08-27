// The coding loop's own named-constants module (docs/goals/0240 S1's
// own "DON'T HARDCODE THINGS" build directive): every design value that
// shapes the Running screen's presentation lives here, in ONE place --
// same shape as enqueuedStale.ts's ENQUEUED_STALE_THRESHOLD_MS. Go and
// TypeScript can't share one literal across the process boundary, so
// the parse/execution-side constants (output-tail line count, the
// event name) have their own single Go-side definition in
// internal/domain/composition/codingloopconfig.go and
// internal/services/executionsvc/executionservice_codingloop.go --
// this file is the TypeScript-side half, not a second copy of either
// concept.

// CODING_LOOP_STUCK_THRESHOLD_MS: once a running step has produced no
// new output for this long, the Running screen shows "stuck for Ns"
// instead of a bare spinner -- the design contract in docs/goals/0240.
export const CODING_LOOP_STUCK_THRESHOLD_MS = 8_000

// CODING_LOOP_POLL_INTERVAL_MS: how often the Running screen re-fetches
// the run's own checkpointed state as a backstop alongside the live
// progress event (the event covers a running step's own output tail;
// this poll is what notices a step transition to done/failed/skipped
// once DBOS checkpoints it) -- same interval liveRunState.ts's own
// useLiveRun poll already uses.
export const CODING_LOOP_POLL_INTERVAL_MS = 1_000

// CODING_LOOP_PROGRESS_EVENT is the Wails event name the Running screen
// subscribes to for live per-step output -- must match
// executionservice_codingloop.go's codingLoopStepProgressEventName
// exactly.
export const CODING_LOOP_PROGRESS_EVENT = 'codingloop-step-progress'
