// Package list holds the core-domain shape of a List (docs/SPEC.md
// §3.5): a reusable (1:many), Configure-authored named lookup table --
// the same reuse cardinality as a Connector, but with no external call
// or credential involved, just a static key/value mapping a workflow's
// list-lookup node reads from at run time. Per CLAUDE.md's core-domain
// rule, the shape and its validation stay hand-written -- no library has
// an opinion on Mill's own List model.
package list

import (
	"fmt"
	"strings"
	"time"
)

// List is one reusable, named lookup table. Entries maps an input key
// (whatever a workflow's list-lookup node is configured to look up) to
// the value that gets written back into the workflow's Attributes.
type List struct {
	ID      string
	Label   string
	Entries map[string]string
	// BuiltIn marks a seeded example list (BuiltIn() below) -- purely
	// informational, same as httprequest.HTTPRequest.BuiltIn/
	// decision.Decision.BuiltIn: drives a "built-in" badge only, never
	// gates Edit/Delete. A seeded example is an ordinary, fully-
	// editable/deletable list from the moment it exists (docs/SPEC.md
	// §2.2's Update note).
	BuiltIn bool
	// CreatedAt/UpdatedAt are system-managed audit timestamps (SPEC.md
	// §3.2.2's reserved-column pattern), stamped server-side at every
	// persisted mutation (ConfigureService), never trusted from the
	// wire. Zero value means pre-timestamp data -- migration-free.
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Validate checks a List is well-formed before it's persisted -- same
// "never store an unconfigured/invalid value" discipline
// internal/domain/composition's ResolveNodeDefaults and
// internal/domain/connector's Validate already apply to their own types.
// An empty Entries map is valid (a list starts empty and gets rows added
// later); a missing Label is not.
func Validate(l List) error {
	if strings.TrimSpace(l.Label) == "" {
		return fmt.Errorf("a list needs a label")
	}
	return nil
}
