// Package atlas holds the core-domain shapes behind Mill's Atlas
// surface (docs/adr/0038): a Kind (user-declared card type), a
// LinkKind (user-declared relation type), a Card (one instance of a
// Kind, placed on a space), and a Link (a typed relation between two
// cards). Per ADR-0038 Decision 2, NOTHING conceptual is hardcoded
// here -- no card-type name, no link-type name, no category ever
// appears as a Go identifier or string literal in this package or
// internal/services/atlassvc outside their own builtin.go/seed files;
// every "kind of thing" a user sees is data they declared (or a seeded
// example, itself fully editable/deletable per docs/SPEC.md §2.2).
//
// Per CLAUDE.md's core-domain rule and .claude/rules/backend.md's
// domain-purity rule, this package stays pure: types and validation
// only, no persistence, no settings-store access -- that lives one
// layer up in internal/services/atlassvc, which owns Atlas's storage
// blob and CRUD lifecycle the same way compositionsvc owns Workflow's.
package atlas

import (
	"fmt"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// Kind is a user-declared card type: a name, an optional description/
// emoji glyph, and a field schema via typedfield.Field -- the exact
// canonical vocabulary list.Column and decision.OutputField already
// converge on (ADR-0029), reused here rather than a fourth near-
// duplicate. Icon is a bare emoji string (e.g. "🧭"), optional --
// rendering/validity of the glyph itself is a frontend concern, not
// checked here.
type Kind struct {
	ID          string
	Label       string
	Description string
	Icon        string
	Fields      []typedfield.Field
	// CreatedAt/UpdatedAt are system-managed audit timestamps (the
	// reserved-column pattern list.List/decision.Decision already
	// follow), stamped server-side at every persisted mutation, never
	// trusted from the wire.
	CreatedAt time.Time
	UpdatedAt time.Time
	// BuiltIn marks a seeded example Kind -- informational only, same
	// as list.List.BuiltIn: drives a badge, never gates edit/delete.
	BuiltIn bool
	// Seed is this Kind's seed provenance (docs/goals/0037), the same
	// insert/upgrade/leave-alone-once-Modified reconcile discipline
	// every other seeded entity in this codebase already carries.
	Seed seedorigin.Origin
}

// ValidateKind checks a Kind is well-formed before it's persisted.
// Field key uniqueness is enforced; a key's immutability across a
// Kind's later edits is explicitly NOT enforced here (goal 0046's own
// scope -- see docs/goals/0061's Validation note).
func ValidateKind(k Kind) error {
	if strings.TrimSpace(k.Label) == "" {
		return fmt.Errorf("a kind needs a label")
	}
	seen := make(map[string]bool, len(k.Fields))
	for _, f := range k.Fields {
		if err := typedfield.Validate(f); err != nil {
			return fmt.Errorf("field: %w", err)
		}
		if seen[f.Key] {
			return fmt.Errorf("duplicate field key %q", f.Key)
		}
		seen[f.Key] = true
	}
	return nil
}

// LinkKind is a user-declared relation type (the "rope" binding two
// cards) -- a name and description only; the relation itself (Link)
// carries the endpoints.
type LinkKind struct {
	ID          string
	Label       string
	Description string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	BuiltIn     bool
	Seed        seedorigin.Origin
}

// ValidateLinkKind checks a LinkKind is well-formed before it's
// persisted.
func ValidateLinkKind(lk LinkKind) error {
	if strings.TrimSpace(lk.Label) == "" {
		return fmt.Errorf("a link kind needs a label")
	}
	return nil
}
