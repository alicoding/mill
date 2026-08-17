package atlas

import (
	"fmt"
	"strings"
	"time"
)

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
}

// ValidateNote checks a Note is well-formed: non-empty text. Whether
// ParentID names an existing card is referential-existence checking,
// left to the service layer like every other domain type in this
// package.
func ValidateNote(n Note) error {
	if strings.TrimSpace(n.Text) == "" {
		return fmt.Errorf("a note needs text")
	}
	return nil
}
