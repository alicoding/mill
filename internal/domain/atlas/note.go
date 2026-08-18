package atlas

import "time"

// Note is a quick-capture annotation on the Atlas board (goal 0081
// slice A1's LOCKED design): structurally excluded from every semantic
// mechanism a Card participates in -- no KindID, no Fields, no links.
// It is its own collection, never registered in projections, the
// traceability matrix, coverage, or jump results, so nothing jotted
// here can accidentally become data. PromoteNote (atlassvc) is the
// only path from a Note to a Card -- one-way, never a soft/reversible
// conversion.
type Note struct {
	ID       string
	Text     string
	Position Position
	// ParentID is the containment primitive a Note shares with Card
	// (spatial filing only -- a note in an area carries no semantic
	// weight from that placement, per the LOCKED design's "containment
	// is location, not meaning").
	ParentID  string
	CreatedAt time.Time
	UpdatedAt time.Time
	// DeletedAt marks this note soft-deleted (goal 0093), same
	// tombstone contract as Card.DeletedAt -- zero value means live.
	DeletedAt time.Time
}

// ValidateNote checks a Note is well-formed. Empty text is LEGAL: a
// note's placement is itself the captured meaning (a spatial
// placeholder typed into later), so deletion is the only removal and
// no text requirement exists. Whether ParentID names an existing card
// is referential-existence checking, left to the service layer like
// every other domain type in this package.
func ValidateNote(n Note) error {
	return nil
}
