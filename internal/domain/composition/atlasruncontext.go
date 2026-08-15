package composition

import "fmt"

// lookupCurrentRunIDFn resolves ExecContext.RunContext (opaque, see that
// field's own doc comment) into the current run's own id -- the same
// "resolve the opaque RunContext on the OTHER side of the seam" shape
// SetRunEvidenceLookup/SetProcessRegistrar already establish, kept as
// its own minimal seam rather than reusing SetRunEvidenceLookup because
// atlas-card-create/update only need the id itself (for the trigger
// cycle guard, docs/goals/0066), not a full assembled RunEvidence.
// Defaults to erroring so a node run before ExecutionService wires
// SetCurrentRunIDLookup fails loudly rather than silently no-op'ing.
var lookupCurrentRunIDFn = func(_ any) (string, error) {
	return "", fmt.Errorf("no current-run lookup registered (yet)")
}

// SetCurrentRunIDLookup wires the function atlas-card-create/update
// nodes use to resolve the run they're executing within. Called once
// from main.go once ExecutionService exists.
func SetCurrentRunIDLookup(fn func(runCtx any) (string, error)) {
	lookupCurrentRunIDFn = fn
}

// currentRunID is a best-effort read of the current run's id -- a
// missing/unwired lookup (a bare unit test that never wires
// SetCurrentRunIDLookup) degrades to "" rather than failing the node:
// the id is only needed for the trigger cycle guard's bookkeeping, not
// for the card write itself to succeed.
func currentRunID(runCtx any) string {
	id, err := lookupCurrentRunIDFn(runCtx)
	if err != nil {
		return ""
	}
	return id
}
