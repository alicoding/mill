package composition

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
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
// outputFields is the operation's declared output field list (Path
// included), and responseExtractPath its document-level extraction
// (docs/SPEC.md §4.1) -- both returned alongside the resolved request
// so the caller can hand them to applyOutputBindings after the HTTP
// call completes without parsing the spec a second time.
func resolveInputBindings(specDoc string, config map[string]string, attrs map[string]any) (path, body string, headers map[string]string, query url.Values, outputFields []openapispec.Field, responseExtractPath string, err error) {
	doc, err := openapispec.Parse([]byte(specDoc))
	if err != nil {
		return "", "", nil, nil, nil, "", fmt.Errorf("parse connector spec: %w", err)
	}
	op, err := doc.Operation(config["path"], config["method"])
	if err != nil {
		return "", "", nil, nil, nil, "", err
	}
	bindings, err := parseBindings(config["inputBindings"])
	if err != nil {
		return "", "", nil, nil, nil, "", fmt.Errorf("inputBindings: %w", err)
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
			return "", "", nil, nil, nil, "", fmt.Errorf("encode bound body fields: %w", err)
		}
		body = string(b)
	}
	return path, body, headers, query, op.OutputFields, op.ResponseExtractPath, nil
}

// applyOutputBindings decodes an HTTP response body's JSON and writes
// each field outputBindings maps into ctx.Attributes -- the ADR-0007
// Phase 3 counterpart to resolveInputBindings. A response that isn't a
// JSON object, or that's missing a bound field, is not an error: an
// integration's response shape can legitimately vary (an error body,
// an empty 204), and a workflow's own Decision/downstream nodes are
// the place to react to a missing Attribute, not this node failing the
// whole run over it.
//
// outputFields is the operation's declared output fields (docs/adr/0011)
// -- a field with a declared Path reads from that dot-path into the
// (possibly nested) response instead of a flat top-level key match by
// Name, which remains the behavior for every field with no Path set
// (nil outputFields, or a field this list doesn't mention, both fall
// back to that same flat lookup -- unconditionally backward compatible
// with every binding authored before Path existed).
//
// responseExtractPath (docs/SPEC.md §4.1) is applied first, narrowing
// respObj to a sub-document before any per-field Path runs against it
// -- e.g. an envelope like {"data":{...}} where every declared field
// actually lives under "data". Empty or "*" (openapispec.Operation's
// own documented "no extraction" values) leaves respObj untouched. A
// path that doesn't resolve falls back to the original, full respObj
// rather than failing the whole binding step -- same permissive
// "a misconfigured extraction isn't a hard error" stance this function
// already takes for a missing per-field Path.
func applyOutputBindings(outputBindingsRaw, respBody, responseExtractPath string, outputFields []openapispec.Field, ctx *ExecContext) error {
	bindings, err := parseBindings(outputBindingsRaw)
	if err != nil {
		return fmt.Errorf("outputBindings: %w", err)
	}
	pathByField := make(map[string]string, len(outputFields))
	for _, f := range outputFields {
		if f.Path != "" {
			pathByField[f.Name] = f.Path
		}
	}

	var respObj any
	if err := json.Unmarshal([]byte(respBody), &respObj); err != nil {
		return nil
	}
	if responseExtractPath != "" && responseExtractPath != "*" {
		if narrowed, ok := extractPath(respObj, responseExtractPath); ok {
			respObj = narrowed
		}
	}
	if ctx.Attributes == nil {
		ctx.Attributes = map[string]any{}
	}
	for fieldName, attrName := range bindings {
		path := pathByField[fieldName]
		if path == "" {
			path = fieldName
		}
		if v, ok := extractPath(respObj, path); ok {
			ctx.Attributes[attrName] = v
		}
	}
	return nil
}

// extractPath walks a dot-separated path through decoded JSON (nested
// map[string]any / []any, as encoding/json produces) -- e.g. "data.name"
// or "items.0.name" (a numeric segment indexes into an array). Scope
// deliberately bounded (docs/adr/0011): supports nested-object
// traversal and numeric array indices, not a wildcard-over-array
// extraction ("items[].name" meaning one value per element) -- an
// Attribute holds one scalar value, not a list, so that's a genuinely
// different shape this doesn't attempt.
func extractPath(obj any, path string) (any, bool) {
	cur := obj
	for _, seg := range strings.Split(path, ".") {
		switch v := cur.(type) {
		case map[string]any:
			next, ok := v[seg]
			if !ok {
				return nil, false
			}
			cur = next
		case []any:
			idx, err := strconv.Atoi(seg)
			if err != nil || idx < 0 || idx >= len(v) {
				return nil, false
			}
			cur = v[idx]
		default:
			return nil, false
		}
	}
	return cur, true
}
