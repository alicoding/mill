package contract

import (
	"encoding/json"
	"fmt"
	"reflect"

	"github.com/invopop/jsonschema"
)

//go:generate go run ./gen

// legacyFieldNotes carries a family's schema-level description where
// the wire vocabulary changed and an old key must keep importing
// (docs/goals/0053 tier 2): today only "workflow" (its "steps" array
// was "nodes" until this rename). An external agent reading the
// committed schema sees the acceptance rule stated here, not just
// inferred from ImportContract's ReadersIgnoreUnknownFields.
var legacyFieldNotes = map[string]string{
	"workflow": `"steps" is this envelope's current wire vocabulary; a document using the legacy "nodes" key (every workflow export produced before this rename) is still accepted on import.`,
}

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
		if note, ok := legacyFieldNotes[family]; ok {
			schema.Description = note
		}
		data, err := json.MarshalIndent(schema, "", "  ")
		if err != nil {
			return nil, fmt.Errorf("marshal schema %q: %w", family, err)
		}
		out[family] = append(data, '\n')
	}
	return out, nil
}
