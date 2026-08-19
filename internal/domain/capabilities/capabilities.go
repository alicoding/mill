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
	ViewHome        ViewKind = "home"
	ViewActivity    ViewKind = "activity"
	ViewReview      ViewKind = "review"
	ViewComposition ViewKind = "composition"
	ViewConfigure   ViewKind = "configure"
	ViewAtlas       ViewKind = "atlas"
	ViewDocs        ViewKind = "docs"
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
	// HiddenFromNav keeps a capability out of the sidebar while it stays
	// a real, navigable view (command palette, footer links, in-app
	// cross-links). For help-shaped surfaces: reachable when wanted,
	// never a standing tab competing with the work surfaces.
	HiddenFromNav bool
}

// List is a best-effort seed, not a claim of precision -- correcting an
// entry here is a normal, cheap code review, not a doc-archaeology
// exercise, which is the whole point of making this real Go data instead
// of inferred text.
// Order here is the sidebar's own order (App.tsx renders capabilities in
// this exact array order, no separate sort) -- Home now leads (docs/
// goals/0014-home-dashboard.md, docs/SPEC.md §3.2.3: "the reason to open
// Mill," and now the app's default landing view -- see store.ts), with
// Composition and Configure right after it (the two other real, working
// destinations -- Composition was the previous default landing view,
// §2.2's Update note), Activity follows right after (a monitoring
// surface, not a primary destination -- the same "present but not
// top-billed" position n8n's own Executions occupies relative to
// Workflows/Credentials), then the remaining not-yet-built placeholders.
// See SPEC.md §3.5's "Sidebar restructuring" bullet for the fuller
// reasoning.
func List() []Capability {
	return []Capability{
		{
			ID: "capability-home", Label: "Home", SpecSection: "3.2.3",
			Status: StatusOpen, View: ViewHome,
		},
		{
			ID: "capability-composition", Label: "Capability composition", NavLabel: "Workflows", SpecSection: "3",
			Status: StatusOpen, View: ViewComposition,
		},
		{
			ID: "capability-configure", Label: "Configure", SpecSection: "3.5",
			Status: StatusOpen, View: ViewConfigure,
		},
		{
			// The projection surface (docs/adr/0038): a zoomable space/card
			// graph over user-owned files, sibling to Workflows/Configure --
			// closes SPEC §0's workbench OPEN.
			ID: "capability-atlas", Label: "Atlas", SpecSection: "0",
			Status: StatusOpen, View: ViewAtlas,
		},
		{
			ID: "activity-log", Label: "Activity / event log", NavLabel: "Activity", SpecSection: "2.2",
			Status: StatusLocked, View: ViewActivity,
		},
		{
			// The human-in-the-loop queue (docs/adr/0023): every parked
			// run -- ambient guardrail asks and Human review checkpoints
			// alike -- across every workflow, in one case-management-style
			// inbox (§3.2's "Review" surface, v1). Composed from the
			// already-built parked-run mechanism, not a new engine.
			ID: "capability-review", Label: "Review queue", NavLabel: "Review", SpecSection: "8",
			Status: StatusLocked, View: ViewReview,
		},
		{
			ID: "capability-docs", Label: "Docs", SpecSection: "9",
			Status: StatusOpen, View: ViewDocs, HiddenFromNav: true,
		},
	}
}
