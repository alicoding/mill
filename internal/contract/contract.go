// Package contract generates and serves Mill's exported-envelope JSON
// Schemas (ADR-0036) -- the self-describing contract an external agent
// reads instead of hand-written, driftable documentation. It owns no
// domain logic and no persistence: each envelope-owning service
// package registers its wire type here at init time, keeping the
// import direction one-way (service -> contract, never back) per
// .claude/rules/backend.md's layering.
package contract

import (
	"fmt"
	"reflect"
	"regexp"
	"sort"
)

// SchemaMajor is the only supported schema major version today
// (ADR-0036 decision 2). An additive, optional-only change to an
// envelope keeps this major; removing/renaming a field, changing a
// field's type, or making an optional field required requires bumping
// it and minting a new schema id.
const SchemaMajor = 1

var registry = map[string]reflect.Type{}

// Register associates family with the Go type whose JSON Schema
// represents its exported envelope. Called from each envelope-owning
// package's init() -- never with the same family twice, since that
// would mean two packages both claim to own one contract family.
func Register(family string, v any) {
	if _, exists := registry[family]; exists {
		panic(fmt.Sprintf("contract: family %q already registered", family))
	}
	registry[family] = reflect.TypeOf(v)
}

// Families returns every registered family name, sorted -- both the
// generator and the drift test iterate this so file order never
// depends on package init order (Go does not guarantee init order
// across packages with no import relationship between them).
func Families() []string {
	out := make([]string, 0, len(registry))
	for f := range registry {
		out = append(out, f)
	}
	sort.Strings(out)
	return out
}

// SchemaID returns family's stable schema identifier (ADR-0036
// decision 2): "mill://schema/<family>/v<major>".
func SchemaID(family string) string {
	return fmt.Sprintf("mill://schema/%s/v%d", family, SchemaMajor)
}

var schemaIDPattern = regexp.MustCompile(`^mill://schema/([a-z]+)/v(\d+)$`)

// ValidateImportSchema enforces ADR-0036 decision 2's import rule for
// family's envelope: an absent schema value is accepted (every export
// written before this ADR), a value naming family at a supported major
// is accepted, and anything else -- a different family, or a major this
// build doesn't support -- is rejected with an error naming the
// supported id.
func ValidateImportSchema(family, schema string) error {
	if schema == "" {
		return nil
	}
	want := SchemaID(family)
	if schema == want {
		return nil
	}
	if m := schemaIDPattern.FindStringSubmatch(schema); m != nil && m[1] == family {
		return fmt.Errorf("unsupported schema %q -- this Mill instance supports %q", schema, want)
	}
	return fmt.Errorf("unrecognized schema %q for this import -- expected %q", schema, want)
}
