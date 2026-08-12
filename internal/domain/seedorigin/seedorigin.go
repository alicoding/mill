// Package seedorigin holds the one small, pure type every built-in-
// origin artifact (a seeded Workflow or Configure entity) carries:
// which shipped revision it was seeded/reconciled from, and whether a
// real mutation has ever touched it since. docs/goals/0037's design --
// see that file for the researched precedent (Kubernetes Server-Side
// Apply's write-time field ownership over client-side hash/diff
// detection; Grafana's ignored-provisioning-version cautionary tale;
// Helm's versioned-history-over-in-place-mutation). Deliberately its
// own leaf domain package (no dependents besides the domain types that
// embed it) rather than living inside internal/services/seeding: that
// package already documents itself as "cross-package HELPERS," while
// Origin is a plain persisted field on domain structs across five
// different domain packages (composition, httprequest, decision, list,
// mcpserver, execenv) -- a domain package importing a services package
// would invert .claude/rules/backend.md's layering.
package seedorigin

// Origin records seed provenance on a built-in-origin artifact.
// SeedRevision == 0 means "not of seed origin" -- either a genuinely
// user-created artifact, or a pre-goal-0037 built-in that hasn't been
// migration-stamped yet (see internal/services/seeding's reconcile
// pass) -- so it doubles as the zero-value-safe "absent" marker, same
// discipline every other reserved/system-owned field in this codebase
// already follows (composition.Workflow.Disabled, list.Row.Status).
// Modified is a one-way latch: once true, reconcile leaves the
// artifact alone regardless of how far SeedRevision drifts from the
// shipped golden's -- set at every mutation choke point (never
// inferred later by diffing content, the exact client-side-hash
// failure mode this design's research explicitly moved away from).
type Origin struct {
	SeedRevision int
	Modified     bool
}

// IsSeeded reports whether this artifact originated from a golden --
// the gate reconcile/Touch/reset logic uses instead of re-deriving
// "SeedRevision > 0" inline at every call site.
func (o Origin) IsSeeded() bool {
	return o.SeedRevision > 0
}

// Touch latches Modified for a real mutation reaching a built-in-
// origin artifact -- a no-op (returns o unchanged) for an artifact
// that was never seeded, since Modified only has meaning relative to a
// shipped golden. Called from every mutation choke point named in
// docs/goals/0037's design (never scattered ad hoc per RPC).
func (o Origin) Touch() Origin {
	if o.IsSeeded() {
		o.Modified = true
	}
	return o
}

// Stamp returns a fresh, unmodified Origin at revision -- used both
// for a brand-new insert (reconcile's "absent" branch) and for a reset/
// upgrade that intentionally clears Modified back to the shipped
// state.
func Stamp(revision int) Origin {
	return Origin{SeedRevision: revision}
}
