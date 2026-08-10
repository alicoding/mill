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
	"fmt"
	"strings"
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
// result contract. Deliberately the same minimal vocabulary
// composition.AttributeDef already uses (Key/Label/Type -- "text" /
// "number" / "boolean" / "options", ConfigFieldType's own string
// values) plus EnumValues (composition.ConfigField.Options's own
// equivalent, one level down) -- NOT a fourth schema system (ADR-0027's
// own explicit non-goal: convergence onto one canonical schema editor
// stays SPEC.md §4.1's named future work). Type stays a plain string
// here (not composition.ConfigFieldType) so this package never has to
// import composition -- composition imports decision instead, the same
// direction it already imports internal/domain/httprequest.
type OutputField struct {
	Key        string
	Label      string
	Type       string
	EnumValues []string
}

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
