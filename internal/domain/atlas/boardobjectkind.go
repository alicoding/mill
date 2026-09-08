package atlas

// EntityRef declares that a board-object kind's Payload carries a
// Configure entity's id under one payload key -- the wire convention
// Payload's own doc comment already names ("listID" for table) turned
// into a checkable declaration instead of a string every reader has to
// know by convention (goal 0392 S1).
type EntityRef struct {
	// PayloadKey is the Payload map key holding the referenced entity's
	// id ("listID" for table).
	PayloadKey string
	// EntityKind is the Configure entity family this reference points
	// into ("list"), the same refKind vocabulary
	// configureservice_refintegrity.go's WorkflowsReferencing already
	// uses -- one namespace for "what kind of thing is referenced",
	// shared by the workflow half and this board half of the same
	// check.
	EntityKind string
}

// DeleteReferencePolicy names what happens to the referenced entity
// when a board object carrying an EntityRef is deleted.
type DeleteReferencePolicy string

const (
	// DeleteReferenceDetach: the board object goes, the entity stays,
	// always discoverable in Configure -- never a silent cascade.
	DeleteReferenceDetach DeleteReferencePolicy = "detach"
	// DeleteReferenceCascadeWhenSoleReference offers deleting the
	// entity too, but only when the reference index shows this was its
	// only live reference.
	DeleteReferenceCascadeWhenSoleReference DeleteReferencePolicy = "cascadeWhenSoleReference"
	// DeleteReferenceAsk always prompts, for a kind where "sole
	// reference" is too expensive to compute up front.
	DeleteReferenceAsk DeleteReferencePolicy = "ask"
)

// BoardObjectKindDecl is one board-object kind's own lifecycle
// declaration: whether it carries a reference to a Configure entity,
// and if so what happens to that entity on delete. Metadata on the
// registry, not per-call-site logic -- a second entity-projecting kind
// inherits the same delete-time/index/toast machinery by declaring the
// same shape, never a new bespoke delete path.
type BoardObjectKindDecl struct {
	Kind string
	// EntityRef is nil for a kind whose Payload names no Configure
	// entity (image, ink, shape, ...).
	EntityRef *EntityRef
	// DeleteReference is the zero value ("") when EntityRef is nil --
	// meaningless for a kind with nothing to detach/cascade/ask about.
	// REQUIRED (checked by boardobjectkind_test.go's enforcement test)
	// whenever EntityRef is non-nil.
	DeleteReference DeleteReferencePolicy
}

// boardObjectKindDecls is BuiltInBoardObjectKinds() restated with each
// kind's own entity-reference declaration -- one entry per built-in
// kind, kept in the same order for readability only (lookup is by
// Kind, never by position).
var boardObjectKindDecls = []BoardObjectKindDecl{
	{Kind: "diagram"},
	{Kind: "image"},
	{Kind: "ink"},
	{Kind: "json"},
	{Kind: "pdf"},
	{Kind: "shape"},
	{Kind: "sheet"},
	// table is the only built-in kind that projects a Configure entity
	// today (goal 0179 S2's own listID convention) -- detach per
	// docs/goals/0392 Decision 1: deleting a table never deletes the
	// List (Airtable/Coda's own view-vs-table asymmetry).
	{Kind: "table", EntityRef: &EntityRef{PayloadKey: "listID", EntityKind: "list"}, DeleteReference: DeleteReferenceDetach},
}

// BoardObjectKindDecls returns every built-in board-object kind's own
// lifecycle declaration.
func BoardObjectKindDecls() []BoardObjectKindDecl {
	return boardObjectKindDecls
}

// BoardObjectKindDeclFor looks up one kind's declaration -- ok is false
// for a kind this registry doesn't know (a third-party plugin kind,
// which declares no entityRef in the compiled-in tier per ADR-0047's
// deferred capability vocabulary).
func BoardObjectKindDeclFor(kind string) (BoardObjectKindDecl, bool) {
	for _, d := range boardObjectKindDecls {
		if d.Kind == kind {
			return d, true
		}
	}
	return BoardObjectKindDecl{}, false
}
