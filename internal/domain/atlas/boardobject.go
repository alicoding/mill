package atlas

import (
	"fmt"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/seedorigin"
)

// BoardObject is a canvas-native peer to Card (goal 0179/0180's
// correction: "a Card is a document, a canvas object is a thing in
// space"). One generic entity discriminated by Kind, not one hand-
// built type per noun -- position/render/select/erase/undo are common
// to every canvas object regardless of what it draws, so those five
// fields are the whole generic shape; everything kind-specific
// (an image's mirrored file, a shape's color/geometry) lives in
// Payload, opaque to this package. Adding a new kind (0169 S5's shape,
// 0179 S2's table/diagram relocation) is a Payload-key convention plus
// a frontend renderer, never a new Go type or a new service file --
// the dupl-cloning goal 0180 exists to prevent.
//
// Structurally excluded from every semantic mechanism a Card
// participates in, the same way Note is (note.go's own LOCKED design):
// no KindID, no Fields, no links, never registered in projections, the
// traceability matrix, coverage, jump results, search, or MCP -- board-
// local by construction, so nothing dropped or drawn here can
// accidentally become data. PromoteBoardObject (atlassvc) is the one
// path from a BoardObject to a Card, one-way, same as PromoteNote.
type BoardObject struct {
	ID   string
	Kind string
	// Payload holds Kind's own data, keyed by a convention only that
	// kind's producer/renderer agree on: "mirrorPath" for a file-backed
	// kind (image, ink, diagram), "listID" for a List-backed kind
	// (table, goal 0179 S2) -- every value stays a plain string on the
	// wire, the same convention Card.Fields already carries against
	// typedfield.Field.
	Payload map[string]string
	// Position is this object's placement within ParentID's canvas --
	// board objects are Free-mode-only (no shelves-auto-arrange
	// concept applies to a thing in space rather than a document).
	Position Position
	// Size is the object's user-chosen board footprint, nil until
	// first resized -- the renderer's own natural/intrinsic size wins
	// until then, same contract as Card.Size.
	Size *Dimensions `json:"Size,omitempty"`
	// ParentID is the containment primitive this type shares with Note
	// and Card (spatial filing only -- "containment is location, not
	// meaning", note.go's own LOCKED design).
	ParentID  string
	CreatedAt time.Time
	UpdatedAt time.Time
	// DeletedAt marks this object soft-deleted (goal 0093's tombstone
	// contract, extended to this type) -- zero value means live.
	DeletedAt time.Time
	// BuiltIn and Seed carry the exact same seed-provenance contract
	// Card already does (goal 0037/0223): BuiltIn marks a golden
	// atlassvc's reconcile inserted, Seed tracks which revision and
	// whether the user has since touched it. A zero Seed means
	// user-created, same as a Card with no seed origin.
	BuiltIn bool
	Seed    seedorigin.Origin
}

// ValidateBoardObject checks a BoardObject is well-formed. Kind is the
// only required field -- Payload's own shape is Kind-specific and
// unchecked here (the service layer's producer already built it
// correctly; this package has no registry of what each Kind requires).
func ValidateBoardObject(o BoardObject) error {
	if strings.TrimSpace(o.Kind) == "" {
		return fmt.Errorf("a board object needs a kind")
	}
	return nil
}
