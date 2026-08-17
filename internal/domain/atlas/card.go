package atlas

import (
	"fmt"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/seedorigin"
)

// ViewMode governs how a container card's CHILDREN render, not the
// card itself -- ADR-0038 Decision 3's "space view mode is per-
// container" call, resolved as a field ON Card rather than a separate
// space/container type: every card can contain (ParentID is the one
// containment primitive, structural regardless of Kind), so a card
// that never gains a child simply never has its ViewMode read. Storing
// it up front means drilling into a previously-childless card later
// needs no schema migration.
type ViewMode string

const (
	// ViewModeCanvas renders children at their saved Position (React
	// Flow, per ADR-0038 Decision 4).
	ViewModeCanvas ViewMode = "canvas"
	// ViewModeShelves renders children auto-grouped by Kind, no
	// position needed -- the default (EffectiveViewMode below), since
	// an empty ViewMode on a freshly-created card must resolve to
	// something rather than rendering nothing.
	ViewModeShelves ViewMode = "shelves"
)

// Position is a card's location within its PARENT's canvas -- only
// meaningful when the parent's EffectiveViewMode is ViewModeCanvas;
// nil for a card whose parent renders as shelves (or for a root card,
// which has no parent canvas to be positioned on).
type Position struct {
	X float64
	Y float64
}

// Card is one instance of a Kind, placed inside another card's
// containment (or at the root, ParentID == ""). Every structural
// capability below is optional and exists on every card regardless of
// Kind (ADR-0038 Decision 2: structure, not concept) -- a card either
// uses a given attribute or leaves it at its zero value.
type Card struct {
	ID     string
	KindID string
	Title  string
	Note   string
	// Fields holds this card's values against its Kind's declared
	// schema, keyed by typedfield.Field.Key -- same "every value stays
	// a plain string on the wire" discipline typedfield.Field's own
	// doc comment establishes.
	Fields map[string]string
	// ParentID is the containment primitive: "" means root-level,
	// otherwise the containing card's ID. Every card can contain
	// (ADR-0038 Decision 3); there is no separate "space" type.
	ParentID string
	// Position is this card's placement within ParentID's canvas, nil
	// unless the parent is in canvas mode.
	Position *Position
	// ViewMode governs how CardID's own children render -- see the
	// type's doc comment above.
	ViewMode ViewMode
	// Source is an optional URL this card mirrors/projects.
	Source string
	// MirrorPath is an optional local file path this card's content is
	// synced to -- empty until a refresh has actually run once.
	MirrorPath string
	// MirrorChecksum is the SHA-256 (lowercase hex) of MirrorPath's
	// content at capture/refresh time -- empty until first computed.
	MirrorChecksum string
	// RefreshWorkflowID optionally names the workflow that refreshes
	// this card's mirror -- "Update now" runs it through the normal
	// guardrail gate (ADR-0038 Decision 4); resolution/existence of the
	// referenced workflow is a service-layer concern, not checked here.
	RefreshWorkflowID string
	// ActionWorkflowIDs are the card's attached actions (goal 0084):
	// callable workflows a user runs against this card from its page
	// or menu, each receiving the card's identity through the same
	// declared-Attributes convention trigger-atlas-card fires with.
	// Supersedes the single RefreshWorkflowID (migrated on restore;
	// the old field stays on the wire for import compatibility).
	ActionWorkflowIDs []string
	// LastSyncedAt is when a refresh action last completed for this
	// card -- zero value means never synced.
	LastSyncedAt time.Time
	// ReceiptRunID optionally names the run whose receipt produced this
	// card's current mirrored content -- provenance for a machine-made
	// write (ADR-0038's integration map).
	ReceiptRunID string
	CreatedAt    time.Time
	UpdatedAt    time.Time
	BuiltIn      bool
	Seed         seedorigin.Origin
}

// EffectiveViewMode returns c's declared ViewMode, defaulting to
// ViewModeShelves for the zero value -- the one place "what does an
// unset ViewMode mean" is decided, so no caller re-derives it.
func (c Card) EffectiveViewMode() ViewMode {
	if c.ViewMode == ViewModeCanvas {
		return ViewModeCanvas
	}
	return ViewModeShelves
}

// ValidateCard checks a Card is well-formed against its resolved Kind.
// kind must already be the Kind named by c.KindID -- resolving KindID
// to a Kind (and rejecting an unknown one) is referential-existence
// checking, the service layer's job per docs/goals/0061's Validation
// note, not this pure package's.
func ValidateCard(c Card, kind Kind) error {
	if strings.TrimSpace(c.Title) == "" {
		return fmt.Errorf("a card needs a title")
	}
	if strings.TrimSpace(c.KindID) == "" {
		return fmt.Errorf("a card needs a kind")
	}
	if c.KindID != kind.ID {
		return fmt.Errorf("card kind %q does not match resolved kind %q", c.KindID, kind.ID)
	}
	declared := make(map[string]bool, len(kind.Fields))
	for _, f := range kind.Fields {
		declared[f.Key] = true
	}
	for key := range c.Fields {
		if !declared[key] {
			return fmt.Errorf("field %q is not declared by kind %q", key, kind.Label)
		}
	}
	return nil
}

// WouldCycle reports whether reparenting the card identified by
// cardID to newParentID would make cardID its own ancestor -- the
// containment-cycle rejection docs/goals/0061 requires. byID must map
// every existing card's ID to itself (the service layer's full card
// set); a newParentID absent from byID is not this check's concern
// (referential existence, checked by the caller) and reports false.
func WouldCycle(cardID, newParentID string, byID map[string]Card) bool {
	if cardID == "" || newParentID == "" {
		return false
	}
	if cardID == newParentID {
		return true
	}
	seen := make(map[string]bool)
	for cur := newParentID; cur != ""; {
		if cur == cardID {
			return true
		}
		if seen[cur] {
			// A cycle elsewhere in the existing data is not this
			// reparent's fault -- stop rather than loop forever.
			return false
		}
		seen[cur] = true
		parent, ok := byID[cur]
		if !ok {
			return false
		}
		cur = parent.ParentID
	}
	return false
}
