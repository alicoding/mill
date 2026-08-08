package composition

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"github.com/alicoding/mill/internal/adapters/openapispec"
)

// attrBindingPrefix marks a binding value as a reference into
// ExecContext.Attributes rather than a literal -- ADR-0007 Phase 3's own
// "attr:<name>" convention. A binding value with no prefix is used
// as-is, the same "literal or reference" shape Decision's rule builder
// and integration-http's original bodyTemplate already established
// elsewhere in this package.
const attrBindingPrefix = "attr:"

// resolveBindingValue resolves one binding's raw config value against
// the running Attributes bag -- a literal passes through unchanged, an
// "attr:<name>" reference is looked up and stringified. A missing
// Attribute resolves to "" rather than erroring -- the same permissive
// fallback attributesEnv already uses for an unset value, so a binding
// referencing an Attribute that hasn't been given a real value yet
// (e.g. mid-authoring) doesn't hard-fail a run.
func resolveBindingValue(raw string, attrs map[string]any) string {
	name, ok := strings.CutPrefix(raw, attrBindingPrefix)
	if !ok {
		return raw
	}
	if v, ok := attrs[name]; ok {
		return fmt.Sprintf("%v", v)
	}
	return ""
}

func parseBindings(raw string) (map[string]string, error) {
	if raw == "" {
		return nil, nil
	}
	var out map[string]string
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil, fmt.Errorf("invalid binding JSON: %w", err)
	}
	return out, nil
}

// resolveInputBindings resolves an integration-http node's inputBindings
// against the connector's parsed OpenAPI spec, placing each declared
// field's resolved value according to its Operation-declared In
// (path/query/header/body) -- the actual mechanism ADR-0007 Phase 3
// names ("resolve inputBindings against ctx.Attributes... per each
// field's declared In placement"). Returns the path (with {param}
// path-template substitutions already applied), the JSON-encoded body
// (empty if no body fields are bound), extra headers, and query values.
func resolveInputBindings(specDoc string, config map[string]string, attrs map[string]any) (path, body string, headers map[string]string, query url.Values, err error) {
	doc, err := openapispec.Parse([]byte(specDoc))
	if err != nil {
		return "", "", nil, nil, fmt.Errorf("parse connector spec: %w", err)
	}
	op, err := doc.Operation(config["path"], config["method"])
	if err != nil {
		return "", "", nil, nil, err
	}
	bindings, err := parseBindings(config["inputBindings"])
	if err != nil {
		return "", "", nil, nil, fmt.Errorf("inputBindings: %w", err)
	}

	path = config["path"]
	headers = map[string]string{}
	query = url.Values{}
	bodyFields := map[string]any{}
	for _, f := range op.InputFields {
		raw, ok := bindings[f.Name]
		if !ok {
			continue
		}
		val := resolveBindingValue(raw, attrs)
		switch f.In {
		case "path":
			path = strings.ReplaceAll(path, "{"+f.Name+"}", val)
		case "query":
			query.Set(f.Name, val)
		case "header":
			headers[f.Name] = val
		default: // "body"
			bodyFields[f.Name] = val
		}
	}
	if len(bodyFields) > 0 {
		b, err := json.Marshal(bodyFields)
		if err != nil {
			return "", "", nil, nil, fmt.Errorf("encode bound body fields: %w", err)
		}
		body = string(b)
	}
	return path, body, headers, query, nil
}

// applyOutputBindings decodes an HTTP response body's top-level JSON
// fields and writes each one outputBindings maps into ctx.Attributes --
// the ADR-0007 Phase 3 counterpart to resolveInputBindings. A response
// that isn't a JSON object, or that's missing a bound field, is not an
// error: an integration's response shape can legitimately vary (an
// error body, an empty 204), and a workflow's own Decision/downstream
// nodes are the place to react to a missing Attribute, not this node
// failing the whole run over it.
func applyOutputBindings(outputBindingsRaw, respBody string, ctx *ExecContext) error {
	bindings, err := parseBindings(outputBindingsRaw)
	if err != nil {
		return fmt.Errorf("outputBindings: %w", err)
	}
	var respObj map[string]any
	if err := json.Unmarshal([]byte(respBody), &respObj); err != nil {
		return nil
	}
	if ctx.Attributes == nil {
		ctx.Attributes = map[string]any{}
	}
	for fieldName, attrName := range bindings {
		if v, ok := respObj[fieldName]; ok {
			ctx.Attributes[attrName] = v
		}
	}
	return nil
}
