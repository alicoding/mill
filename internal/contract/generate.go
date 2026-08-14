package contract

import (
	"encoding/json"
	"fmt"
	"reflect"

	"github.com/invopop/jsonschema"
)

//go:generate go run ./gen

// GenerateAll reflects every registered family's Go type into an
// indented JSON Schema document, keyed by family. Deterministic by
// construction (ADR-0036 decision 1, invopop/jsonschema's own
// guarantee): struct fields render in declaration order and $defs
// marshal with sorted keys, so the same registry always produces the
// same bytes -- what makes a committed, diffed schema file meaningful.
func GenerateAll() (map[string][]byte, error) {
	out := make(map[string][]byte, len(registry))
	for _, family := range Families() {
		reflector := &jsonschema.Reflector{ExpandedStruct: true}
		schema := reflector.Reflect(reflect.New(registry[family]).Interface())
		schema.ID = jsonschema.ID(SchemaID(family))
		data, err := json.MarshalIndent(schema, "", "  ")
		if err != nil {
			return nil, fmt.Errorf("marshal schema %q: %w", family, err)
		}
		out[family] = append(data, '\n')
	}
	return out, nil
}
