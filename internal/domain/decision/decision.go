// Package decision holds the core-domain shape of a Decision
// (docs/SPEC.md §3, docs/adr/0027): a reusable (1:many), Configure-
// authored TERMINAL outcome -- an outcome category, a typed output
// schema, and an optional webhook fired when it's reached -- that a
// workflow's decision-outcome node references by ID. Distinct from
// composition's own "decision-route" node (routing, relabeled "Branch"
// by ADR-0027): a Branch picks a next step, a Decision here ENDS the
// workflow with a typed result. Per CLAUDE.md's core-domain rule, the
// shape and its validation stay hand-written -- no library has an
// opinion on Mill's own terminal-outcome model.
package decision

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// Category is a Decision's outcome classification -- immutable once
// created (ConfigureService.UpdateDecision rejects a category change;
// Duplicate is the migration path, mirroring the reference no-code
// platform ADR-0027 was designed against). Validate below only checks
// shape validity, not immutability -- that's an update-time-only
// concern a pure value has no way to express (it would need the
// previously-stored value to compare against).
type Category string

const (
	CategoryApprove       Category = "approve"
	CategoryDeny          Category = "deny"
	CategoryManualReview  Category = "manual-review"
	CategoryActionNeeded  Category = "action-needed"
	CategoryUncategorized Category = "uncategorized"
)

func validCategory(c Category) bool {
	switch c {
	case CategoryApprove, CategoryDeny, CategoryManualReview, CategoryActionNeeded, CategoryUncategorized:
		return true
	}
	return false
}

// OutputField declares one named, typed field in a Decision's terminal
// result contract. A type alias of typedfield.Field (docs/adr/0029,
// Phase 2) -- the same canonical leaf composition.ConfigField/
// AttributeDef converged onto in Phase 1, not a fourth schema system
// (ADR-0027's own explicit non-goal: convergence onto one canonical
// schema editor stays SPEC.md §4.1's named future work). typedfield is
// a leaf package with zero internal imports, so decision importing it
// creates no cycle -- composition already imports decision (and now
// also typedfield directly, Phase 1), the same direction it already
// imports internal/domain/httprequest.
//
// Wire change from this alias: the field this package used to call
// EnumValues is now Options (typedfield.Field's own name for the
// identical concept -- ConfigField/AttributeDef already called it
// that). Decision's own UnmarshalJSON below migrates an
// already-persisted {"EnumValues": [...]} document forward at decode
// time, the same "migrate the old shape forward on load, never drop
// real data" precedent ADR-0016's configure-connectors ->
// configure-requests key rename already established -- just applied at
// the field level here instead of the settings-key level, since
// Decision unmarshals directly via encoding/json rather than through a
// keyed settings-store migration.
type OutputField = typedfield.Field

// Decision is one reusable, Configure-authored terminal outcome.
// WebhookRequestID optionally references an HTTPRequest entity by ID --
// deliberately NOT a second outbound-HTTP config surface of its own
// (URL/auth/retry fields), by direct decision recorded in ADR-0027: the
// governed outbound capability (auth strategies, keychain secrets,
// retries, guardrail effect) already exists once via HTTPRequest/
// integration-http, and duplicating it here is exactly the anti-pattern
// the reference platform's own review warned against.
type Decision struct {
	ID               string
	Label            string
	Category         Category
	Outputs          []OutputField
	WebhookRequestID string
	// BuiltIn marks a seeded, top-up example (builtin.go) -- purely
	// informational, same as composition.Workflow.BuiltIn /
	// httprequest.HTTPRequest.BuiltIn: the UI badges it, and a deleted
	// built-in gets a tombstone (internal/services/seeding) so top-up
	// seeding never resurrects it.
	BuiltIn bool
	// CreatedAt/UpdatedAt are system-managed audit timestamps (SPEC.md
	// §3.2.2's reserved-column pattern), stamped server-side at every
	// persisted mutation (ConfigureService), never trusted from the
	// wire. Zero value means pre-timestamp data -- migration-free.
	CreatedAt time.Time
	UpdatedAt time.Time
	// Seed is this decision's seed provenance (docs/goals/0037) --
	// zero value means "not of seed origin," migration-free. See
	// composition.Workflow.Seed's doc comment for the full reasoning.
	Seed seedorigin.Origin
}

// legacyOutputField mirrors the pre-ADR-0029 OutputField's own wire
// shape, just enough to read its EnumValues key back out -- decoding a
// document written before OutputField became typedfield.Field's
// Options-named alias. Kept private and minimal (only the one field
// that changed name) rather than a full duplicate struct.
type legacyOutputField struct {
	EnumValues []string `json:"EnumValues"`
}

// UnmarshalJSON migrates an already-persisted Decision's Outputs
// forward: EnumValues -> Options, exactly once, only when a decoded
// output field has no Options of its own (a document written before
// this migration never has one; a document written after it always
// does, so this is a no-op on anything already migrated -- safe to run
// on every load, not just once). type alias avoids the naive
// recursive-UnmarshalJSON trap (calling json.Unmarshal on *Decision
// again from inside Decision's own UnmarshalJSON would recurse forever)
// -- the same shape Go's own encoding/json docs recommend for this
// exact situation.
func (d *Decision) UnmarshalJSON(data []byte) error {
	type alias Decision
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*d = Decision(a)

	var wire struct {
		Outputs []legacyOutputField `json:"Outputs"`
	}
	if err := json.Unmarshal(data, &wire); err != nil {
		// The primary decode above already succeeded; a malformed
		// Outputs shape here would have failed that too, so this
		// second, narrower decode failing is unexpected -- fail safe
		// by skipping the migration rather than erroring the whole
		// load over a cosmetic legacy-field read.
		return nil
	}
	for i := range d.Outputs {
		if i >= len(wire.Outputs) {
			break
		}
		if len(d.Outputs[i].Options) == 0 && len(wire.Outputs[i].EnumValues) > 0 {
			d.Outputs[i].Options = wire.Outputs[i].EnumValues
		}
	}
	return nil
}

// Validate checks a Decision is well-formed before it's persisted --
// same "never store an unconfigured/invalid value" discipline every
// other Configure-authored entity's Validate already applies (see
// internal/domain/mcpserver.Validate, internal/domain/list.Validate).
func Validate(d Decision) error {
	if strings.TrimSpace(d.Label) == "" {
		return fmt.Errorf("a decision needs a label")
	}
	if !validCategory(d.Category) {
		return fmt.Errorf("a decision needs a valid category (got %q)", d.Category)
	}
	seen := make(map[string]bool, len(d.Outputs))
	for _, f := range d.Outputs {
		key := strings.TrimSpace(f.Key)
		if key == "" {
			return fmt.Errorf("a decision's output fields need a non-empty key")
		}
		if seen[key] {
			return fmt.Errorf("a decision's output field key %q is declared more than once", key)
		}
		seen[key] = true
	}
	return nil
}
