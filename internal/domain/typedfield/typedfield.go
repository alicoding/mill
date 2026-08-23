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
	"slices"
	"strconv"
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

	// TypeCardRef is a single reference to another Atlas card
	// (docs/goals/0152 slice 2): the wire value is the target card's
	// ID, and RefKind carries the TARGET ATLAS KIND's id -- safe reuse,
	// the field's own Type discriminates the interpretation (for every
	// other type RefKind names a Configure entity family). Single-value
	// and single-target-kind deliberately: the converged relation shape
	// (one target database/table) recorded in the goal file. Existence/
	// kind checks against live cards belong to the atlas service's own
	// write path, never here -- this package stays storage-free.
	TypeCardRef Type = "cardref"
)

func validType(t Type) bool {
	switch t {
	case TypeText, TypeNumber, TypeBoolean, TypeOptions,
		TypeInteger, TypeObject, TypeArray, TypeMap, TypeDate, TypeDatetime,
		TypeCardRef:
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
	// OptionColors optionally pairs Options by index with a semantic
	// color name (goal 0105: the select-option-color convergence --
	// a color belongs to the option's definition). Empty/short slices
	// are legal: any option without an explicit color auto-assigns
	// deterministically from the standard palette by index, so the
	// same field renders identically on every surface. omitempty
	// keeps color-less fields' JSON byte-identical to pre-field data
	// (persisted stores and seed fingerprints untouched).
	OptionColors []string `json:"OptionColors,omitempty"`
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
	// ShowOnCard surfaces this field's value on a card's compact face
	// (docs/goals/0152) -- read by Atlas Kinds only; other
	// schema-carrying surfaces (List columns, Decision outputs) ignore
	// it, the same per-surface-facet convention Multiline/Secret
	// already follow. A presentation facet, freely togglable -- never
	// part of the Key/Type identity ValidateFieldEvolution pins.
	ShowOnCard bool `json:"ShowOnCard,omitempty"`
	// Multiline marks a text field whose values are naturally
	// multi-line documents (an HTML payload, a JSON arguments object).
	Multiline bool
	// SystemManaged marks a field as platform-owned/reserved (goal
	// 0011's audit columns -- created/updated by/at, Active/Expired row
	// lifecycle on a future typed List) rather than user-declarable.
	// Not consumed by Phase 1/2's converging types yet.
	SystemManaged bool
	// Deprecated marks a field as soft-retired (docs/adr/0040 decision
	// 2): still valid on every value already bound to it, rendered
	// de-emphasized in an entity's own edit form, and excluded from a
	// picker offering fields for a NEW binding. JSON-tagged with
	// omitempty -- unlike every field above -- so an entity with no
	// deprecated fields marshals byte-identical to before this field
	// existed (every other Field member has no tag at all and is
	// always emitted, even at its zero value; this one field must stay
	// invisible at its zero value instead).
	Deprecated bool `json:"deprecated,omitempty"`
	// StampOnChange names a companion field on the same Kind (a
	// TypeDate) to stamp with today's date whenever THIS field's own
	// value changes away from its Default (docs/goals/0164) -- e.g. a
	// lifecycle Options field ("pending-verify" -> "verified") paired
	// with a date field recording when that transition happened.
	// Write-path only (internal/services/atlassvc applies it); this
	// package stays storage-free and never stamps anything itself.
	// Empty means no stamping. JSON-tagged with omitempty, matching
	// Deprecated's own reasoning: a field declaring no pairing marshals
	// byte-identical to before this facet existed.
	StampOnChange string `json:"StampOnChange,omitempty"`
	// FrontmatterAliases lists alternate raw frontmatter keys this
	// field's value may be read from, checked in order, when a parsed
	// header's own key doesn't literally match this field's Key
	// (docs/goals/0172's frontmatter mirror). Read by the Atlas
	// frontmatter coercion path only; every other schema-carrying
	// surface ignores it, the same per-surface-facet convention
	// ShowOnCard/Multiline already follow. The ordinary case for a NEW
	// field is nil -- its own Key doubles as the frontmatter key it
	// reads, which is what lets an arbitrary folder's keys need no
	// code at all; this facet exists only for a field whose Key
	// predates the header it now mirrors. JSON-tagged with omitempty,
	// matching StampOnChange's own reasoning.
	FrontmatterAliases []string `json:"FrontmatterAliases,omitempty"`
	// RollupDoneValues marks a TypeOptions field as its Kind's container
	// rollup (docs/goals/0164 L3): a card whose CHILDREN carry a Kind
	// with such a field shows "<done> of <total>" on its own containing
	// card face, alongside the existing child count -- "<total>" is
	// every direct child of that Kind, "<done>" is however many carry
	// one of these values. A Kind with no field declaring this stays
	// unchanged (no rollup badge at all), the same opt-in shape
	// ShowOnCard already follows. Only meaningful for TypeOptions
	// (Validate rejects a non-empty RollupDoneValues on any other Type,
	// and any value not present in the field's own Options); a Kind
	// with more than one field declaring it is not a supported shape --
	// callers use the first in declaration order. JSON-tagged with
	// omitempty, matching StampOnChange's own reasoning: a field
	// declaring no rollup marshals byte-identical to before this facet
	// existed.
	RollupDoneValues []string `json:"RollupDoneValues,omitempty"`
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
	if len(f.RollupDoneValues) > 0 {
		if f.Type != TypeOptions {
			return fmt.Errorf("field %q declares RollupDoneValues but is not a TypeOptions field", f.Key)
		}
		for _, v := range f.RollupDoneValues {
			if !slices.Contains(f.Options, v) {
				return fmt.Errorf("field %q's RollupDoneValues contains %q, which is not one of its own Options %v", f.Key, v, f.Options)
			}
		}
	}
	return nil
}

// ValidateValue checks raw (a wire-format value string, the same
// plain-string convention every Node.Config/Row.Values/etc. already
// uses) against f's declared Type -- the "typed-column validation
// errors surface honestly, never silent coercion" rule
// docs/goals/0070 introduced for List row writes, written here (not
// List-specific) since no other Field-typed value writer validates
// against Type today either and a second copy would be exactly the
// kind of near-duplicate ADR-0029 exists to avoid. An empty raw always
// passes -- an unset/cleared value is not a type error. TypeOptions
// with an empty Options list accepts any value (no options declared
// yet means nothing to check against); every other Type not
// explicitly handled below (TypeObject/TypeArray/TypeMap/TypeDate/
// TypeDatetime -- ADR-0029's declared-but-not-yet-consumed superset)
// passes unchecked, same as TypeText.
func ValidateValue(f Field, raw string) error {
	if raw == "" {
		return nil
	}
	switch f.Type {
	case TypeNumber:
		if _, err := strconv.ParseFloat(raw, 64); err != nil {
			return fmt.Errorf("field %q expects a number, got %q", f.Key, raw)
		}
	case TypeInteger:
		if _, err := strconv.ParseInt(raw, 10, 64); err != nil {
			return fmt.Errorf("field %q expects an integer, got %q", f.Key, raw)
		}
	case TypeBoolean:
		if raw != "true" && raw != "false" {
			return fmt.Errorf("field %q expects true or false, got %q", f.Key, raw)
		}
	case TypeOptions:
		if len(f.Options) > 0 && !slices.Contains(f.Options, raw) {
			return fmt.Errorf("field %q must be one of %v, got %q", f.Key, f.Options, raw)
		}
	}
	return nil
}

// ValidateRequired checks, in fields' declared order, every field
// whose Key has an entry in messages: if that field is Required and
// values[Key] is blank, returns messages[Key] verbatim. A Required
// field with no messages entry is silently skipped -- Field carries
// no per-field custom message facet (ADR-0029's frozen shape), so a
// field whose missing-value rule needs its own wording, or is only
// conditionally required, is left to the caller's own follow-up
// check (see internal/domain/aiprovider.Validate's Kind/BaseURL
// checks) rather than misfiring a generic message here. This is the
// mechanical half every Configure entity declaring its shape as
// []Field shares; entity-specific conditional/cross-field rules stay
// local, the same "Stays out" boundary ADR-0029 already draws.
func ValidateRequired(fields []Field, values map[string]string, messages map[string]string) error {
	for _, f := range fields {
		msg, ok := messages[f.Key]
		if !ok || !f.Required {
			continue
		}
		if strings.TrimSpace(values[f.Key]) == "" {
			return fmt.Errorf("%s", msg)
		}
	}
	return nil
}

// FieldTombstone records one schema field a Configure entity has
// deleted (docs/adr/0040 decision 3): the Key stays reserved after
// deletion, so ValidateFieldEvolution can reject the same Key
// resurrecting under a different Type.
type FieldTombstone struct {
	Key  string
	Type Type
}

// ValidateFieldEvolution enforces ADR-0040 decisions 1-3 at a schema-
// carrying entity's update chokepoint -- called from each entity's own
// Update* path (never from Validate, which has no access to the
// entity's previous state). oldFields/newFields are that field set's
// state before and after the update; tombstones is the FULL tombstone
// list this update will persist (the caller merges any newly declared
// deletions into the entity's existing list first -- see
// MergeTombstones -- so this stays a pure comparison).
//
// A Key present in oldFields must still be present in newFields with
// the SAME Type (decision 1's identity freeze, decision 2's never-
// retype-in-place rule) -- unless it's recorded in tombstones with a
// matching Type, the one legal way for a Key to disappear: an explicit
// delete declared in the same call, never a silent omission. A Key
// entering newFields that's already in tombstones must match the
// tombstoned Type -- the same Key with the same Type may resurrect, a
// different Type may not.
func ValidateFieldEvolution(oldFields, newFields []Field, tombstones []FieldTombstone) error {
	tombstoned := make(map[string]Type, len(tombstones))
	for _, t := range tombstones {
		tombstoned[t.Key] = t.Type
	}
	current := make(map[string]Field, len(newFields))
	for _, f := range newFields {
		current[f.Key] = f
	}

	for _, old := range oldFields {
		next, stillPresent := current[old.Key]
		if !stillPresent {
			tType, wasTombstoned := tombstoned[old.Key]
			if !wasTombstoned {
				return fmt.Errorf("field %q cannot be removed without deleting it -- its key stays reserved; use the field editor's delete action", old.Key)
			}
			if tType != old.Type {
				return fmt.Errorf("field %q is tombstoned as type %q but is actually type %q -- schema and tombstone disagree", old.Key, tType, old.Type)
			}
			continue
		}
		if next.Type != old.Type {
			return fmt.Errorf("field %q's type cannot change after creation (it is %q) -- add a new field and deprecate this one instead", old.Key, old.Type)
		}
	}

	for _, f := range newFields {
		tType, wasTombstoned := tombstoned[f.Key]
		if wasTombstoned && f.Type != tType {
			return fmt.Errorf("field %q was previously deleted as type %q -- it cannot be re-added as type %q", f.Key, tType, f.Type)
		}
	}
	return nil
}

// MergeTombstones unions existing with additions, deduped by Key --
// existing wins on a Key collision, since only the ORIGINAL delete's
// Type is the historically accurate one. Order is deterministic
// (existing first, then any genuinely new addition, both in their own
// given order) so two calls with the same inputs always produce the
// same persisted bytes. Callers pass the result to
// ValidateFieldEvolution as the tombstone list this update will
// persist going forward.
func MergeTombstones(existing, additions []FieldTombstone) []FieldTombstone {
	byKey := make(map[string]FieldTombstone, len(existing)+len(additions))
	order := make([]string, 0, len(existing)+len(additions))
	for _, t := range existing {
		if _, ok := byKey[t.Key]; !ok {
			order = append(order, t.Key)
		}
		byKey[t.Key] = t
	}
	for _, t := range additions {
		if _, ok := byKey[t.Key]; !ok {
			order = append(order, t.Key)
			byKey[t.Key] = t
		}
	}
	out := make([]FieldTombstone, 0, len(order))
	for _, k := range order {
		out = append(out, byKey[k])
	}
	return out
}
