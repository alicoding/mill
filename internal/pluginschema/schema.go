// Package pluginschema generates the authoring schema published with the
// plugin SDK. Runtime semantics remain owned by pluginsvc's loader and
// conformance checks.
package pluginschema

import (
	"encoding/json"
	"fmt"

	"github.com/alicoding/mill/internal/services/pluginsvc"
	"github.com/invopop/jsonschema"
)

//go:generate go run ./gen

const ID = "mill://schema/plugin-manifest/v1"

// Generate reflects the loader's manifest type into its deterministic JSON
// Schema 2020-12 authoring artifact.
func Generate() ([]byte, error) {
	reflector := &jsonschema.Reflector{
		ExpandedStruct:             true,
		RequiredFromJSONSchemaTags: true,
	}
	schema := reflector.Reflect(&pluginsvc.Manifest{})
	schema.ID = jsonschema.ID(ID)
	data, err := json.MarshalIndent(schema, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal plugin manifest schema: %w", err)
	}
	return append(data, '\n'), nil
}
