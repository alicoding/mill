// Package capabilities is Mill's own hand-written registry of what the
// app can do and where each piece stands (CLAUDE.md: "the action/
// capability model and its composition rules" is named explicitly as
// core domain, never delegated to a library). It exists so the app can
// project its own build status as real data instead of a UI feature
// having to infer structure from docs/SPEC.md's prose -- see
// docs/SPEC.md §2.2 for the decision record.
package capabilities

// Status mirrors docs/SPEC.md's own LOCKED/OPEN/PARKED convention, but
// this package is the authoritative, machine-read source for it; SPEC.md's
// tags remain human-readable commentary, not something anything parses.
type Status string

const (
	StatusLocked Status = "LOCKED"
	StatusOpen   Status = "OPEN"
	StatusParked Status = "PARKED"
)

// ViewKind identifies which page a capability's entry point navigates to.
type ViewKind string

const (
	ViewActivity    ViewKind = "activity"
	ViewComposition ViewKind = "composition"
	ViewPlaceholder ViewKind = "placeholder"
)

type Capability struct {
	ID          string
	Label       string
	SpecSection string
	Status      Status
	View        ViewKind
	// EditorPath is only set for backend-only capabilities with no UI at
	// all -- it must point at a file that actually exists today (an ADR,
	// a real source file), never an aspirational package that hasn't been
	// built yet. Enforced by TestList_EditorPathsExist.
	EditorPath string
	// NavLabel is the terse form shown in the top nav bar (every
	// capability gets a nav entry, built or not -- docs/SPEC.md §2.2).
	// Falls back to Label when empty, which is fine for most placeholder
	// entries; only set this when Label is too long/descriptive for a
	// tab (e.g. "Activity / event log" -> "Activity").
	NavLabel string
}

// List is a best-effort seed, not a claim of precision -- correcting an
// entry here is a normal, cheap code review, not a doc-archaeology
// exercise, which is the whole point of making this real Go data instead
// of inferred text.
func List() []Capability {
	return []Capability{
		{
			ID: "activity-log", Label: "Activity / event log", NavLabel: "Activity", SpecSection: "2.2",
			Status: StatusLocked, View: ViewActivity,
		},
		{
			ID: "copilot-bridge", Label: "M365 Copilot chat bridge", SpecSection: "2.1",
			Status: StatusOpen, View: ViewPlaceholder,
		},
		{
			ID: "capability-composition", Label: "Capability composition", NavLabel: "Composition", SpecSection: "3",
			Status: StatusOpen, View: ViewComposition,
		},
		{
			ID: "connectors", Label: "Connectors", SpecSection: "4",
			Status: StatusOpen, View: ViewPlaceholder,
		},
		{
			ID: "process-tracking", Label: "Process & session tracking", SpecSection: "7",
			Status: StatusOpen, View: ViewPlaceholder,
			EditorPath: "docs/adr/0004-execution-process-tracking.md",
		},
		{
			ID: "guardrails", Label: "Guardrails / policy", SpecSection: "8",
			Status: StatusOpen, View: ViewPlaceholder,
		},
	}
}
