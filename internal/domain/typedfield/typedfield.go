// Package typedfield holds Mill's canonical leaf field type
// (docs/adr/0029): the one "name + typed value" declaration shape every
// accreted field vocabulary in this codebase
// (composition.ConfigField/AttributeDef, decision.OutputField, and --
// deliberately out of scope for now, ADR-0029 Phase 3 --
// openapispec.Field) converges onto, so the next capability declares a
// field once instead of adding a fifth near-duplicate.
//
// A leaf package deliberately: the import graph (verified before this
// package existed, ADR-0029's Decision section) is
// composition -> decision/list/openapispec, so a canonical type living
// inside composition would force decision/list to import composition --
// the exact cycle decision.OutputField.Type's own bare-string workaround
// was written to avoid. Zero internal imports here (mirrors
// internal/domain/decision, internal/domain/list, internal/domain/
// guardrail's own leaf shape) means composition, decision, and list can
// all import typedfield without creating one.
//
// Every value stays a plain string on the wire (Node.Config/Values/List
// entries are already map[string]string) -- Field only governs
// validation/rendering/coercion at the Go layer, never the wire shape.
// Per CLAUDE.md's core-domain rule, this stays hand-written: no library
// has an opinion on Mill's own node/attribute/decision-output field
// model.
package typedfield

import (
	"fmt"
	"strings"
)

// Type is a field's declared value shape. TypeText/TypeNumber/
// TypeBoolean/TypeOptions are wire-identical to today's
// composition.ConfigFieldType values ("text"/"number"/"boolean"/
// "options") -- no migration needed for anything already persisted.
// TypeInteger/TypeObject/TypeArray/TypeMap/TypeDate/TypeDatetime are
// additive, a strict superset covering what §4.1's reference-platform
// review already named as real future field types (goal 0011's List
// columns, ADR-0011's schema-authoring maturity) -- not consumed by
// Phase 1/2 of ADR-0029 yet, declared now so a later capability doesn't
// need a sixth enum value added to a type nobody else references.
type Type string

const (
	TypeText    Type = "text"
	TypeNumber  Type = "number"
	TypeBoolean Type = "boolean"
	TypeOptions Type = "options"

	TypeInteger  Type = "integer"
	TypeObject   Type = "object"
	TypeArray    Type = "array"
	TypeMap      Type = "map"
	TypeDate     Type = "date"
	TypeDatetime Type = "datetime"
)

func validType(t Type) bool {
	switch t {
	case TypeText, TypeNumber, TypeBoolean, TypeOptions,
		TypeInteger, TypeObject, TypeArray, TypeMap, TypeDate, TypeDatetime:
		return true
	}
	return false
}

// Field is the canonical "name + typed value" declaration, exactly as
// recorded in ADR-0029's Decision section. Every existing consumer's
// field set is a subset of this one (composition.ConfigField already
// carries Key/Label/Description/Default/Type/Options/RefKind/Multiline/
// Suggestions; composition.AttributeDef only Key/Label/Type;
// decision.OutputField only Key/Label/Type/EnumValues-renamed-Options)
// -- Phase 1/2 make those three type aliases of this struct rather than
// hand-copying it three times.
type Field struct {
	Key         string
	Label       string
	Type        Type
	Required    bool
	Default     string
	Description string
	// Options is only meaningful when Type == TypeOptions -- the set of
	// values a field's value must be one of. Named Options rather than
	// keeping decision.OutputField's own EnumValues, since Options is
	// what two of the three converging types (ConfigField/AttributeDef)
	// already called the identical concept.
	Options []string
	// Suggestions offers non-restrictive autocomplete hints (an HTML5
	// datalist on the frontend) -- unlike Options, any value is still
	// accepted. Only meaningful for TypeText fields today (ADR-0016).
	Suggestions []string
	// Secret marks a field whose value must never be echoed back once
	// set (a write-only credential) -- not consumed by any Phase 1/2
	// converging type yet (none of ConfigField/AttributeDef/OutputField
	// declare secrets today; httprequest/openapispec's own IsSecret
	// concept is Phase 3, out of scope), included now because it's part
	// of ADR-0029's accepted Field shape.
	Secret bool
	// RefKind marks a field whose value is the ID of a Configure-
	// authored entity ("request" | "list" | "mcpserver" | "decision" |
	// "workflow" | "execenv", docs/adr/0009) -- empty for an ordinary
	// field. Orthogonal to Type: the wire value is still a plain string
	// ID.
	RefKind string
	// Multiline marks a text field whose values are naturally
	// multi-line documents (an HTML payload, a JSON arguments object).
	Multiline bool
	// SystemManaged marks a field as platform-owned/reserved (goal
	// 0011's audit columns -- created/updated by/at, Active/Expired row
	// lifecycle on a future typed List) rather than user-declarable.
	// Not consumed by Phase 1/2's converging types yet.
	SystemManaged bool
}

// Validate checks a Field is well-formed -- same "never store an
// unconfigured/invalid value" discipline every other domain package's
// own Validate already applies (internal/domain/list.Validate,
// internal/domain/decision.Validate, internal/domain/mcpserver.Validate).
func Validate(f Field) error {
	if strings.TrimSpace(f.Key) == "" {
		return fmt.Errorf("a field needs a non-empty key")
	}
	if !validType(f.Type) {
		return fmt.Errorf("field %q has an invalid type %q", f.Key, f.Type)
	}
	return nil
}
