// Package openapispec wraps github.com/getkin/kin-openapi behind Mill's
// own names, per CLAUDE.md's ports/adapters rule -- no other Mill
// package imports "github.com/getkin/kin-openapi/openapi3" directly,
// same shape internal/adapters/mcpclient already uses for the MCP Go
// SDK. Adopted per ADR-0007: a Connector's declared input/output field
// schema is an OpenAPI 3.x document, parsed at runtime (not codegen --
// oapi-codegen was checked and rejected for exactly that reason, a
// user-authored connector has no spec to generate against at build
// time), since OpenAPI is the one format that expresses a field's HTTP
// placement (path/query/header/body) alongside its type, which plain
// JSON Schema can't.
package openapispec

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/getkin/kin-openapi/openapi3"
)

// Document is one parsed, validated OpenAPI 3.x spec.
type Document struct {
	doc *openapi3.T
}

// Parse loads and validates an OpenAPI 3.x document (JSON or YAML --
// kin-openapi's loader detects the format automatically).
func Parse(data []byte) (*Document, error) {
	doc, err := openapi3.NewLoader().LoadFromData(data)
	if err != nil {
		return nil, fmt.Errorf("openapispec: parse: %w", err)
	}
	if err := doc.Validate(context.Background()); err != nil {
		return nil, fmt.Errorf("openapispec: invalid OpenAPI document: %w", err)
	}
	return &Document{doc: doc}, nil
}

// OperationRef identifies one callable operation in a Document, for a
// Configure-time operation picker.
type OperationRef struct {
	Path    string
	Method  string
	Summary string
}

// httpMethods is the fixed, checked set of methods PathItem.GetOperation
// recognizes (openapi3/path_item.go) -- iterated in a stable order so
// Operations' output is deterministic.
var httpMethods = []string{
	http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch,
	http.MethodDelete, http.MethodHead, http.MethodOptions, http.MethodTrace, http.MethodConnect,
}

// Operations lists every path+method combination the spec declares, in
// stable (path, then method) order.
func (d *Document) Operations() []OperationRef {
	if d.doc.Paths == nil {
		return nil
	}
	paths := d.doc.Paths.Keys()
	sort.Strings(paths)

	var out []OperationRef
	for _, path := range paths {
		item := d.doc.Paths.Find(path)
		if item == nil {
			continue
		}
		for _, method := range httpMethods {
			op := item.GetOperation(method)
			if op == nil {
				continue
			}
			out = append(out, OperationRef{Path: path, Method: method, Summary: op.Summary})
		}
	}
	return out
}

// Field is one declared input or output field of an Operation --
// ADR-0029 Phase 3: embeds the canonical typedfield.Field
// (Key/Label/Type/Required/Default/Description/Options/Secret/...)
// rather than hand-copying a fourth near-duplicate vocabulary. The
// mapping from this package's original field names is a real semantic
// unification, not a blind rename: Name->Key, Alias->Label (openapispec
// never had a Label; Alias already meant "friendlier display name," the
// same concept), Type string->typedfield.Type (schemaType translates
// OpenAPI's own type/format keywords into it), EnumValues->Options,
// IsSecret->Secret. In and Path stay openapispec-only extensions below
// -- HTTP placement and nested-response extraction mean nothing to any
// other typedfield consumer (ConfigField/AttributeDef/
// decision.OutputField), ADR-0029's own "can't-unify" list. This
// struct is a runtime VIEW computed fresh from a parsed OpenAPI
// document every call -- never itself persisted -- so there is no wire
// format of Field's own to keep compatible; the OpenAPI document JSON
// underneath (Name/Alias/Path's real storage, via x-mill-* vendor
// extensions) is completely unchanged by this.
type Field struct {
	typedfield.Field
	// In is this field's HTTP placement: "path" | "query" | "header" |
	// "cookie" | "body".
	In string
	// Path is a dot-separated path into (possibly nested) response JSON
	// for extracting this field's value (docs/adr/0011), read from the
	// x-mill-path extension -- empty means "read Key as a flat
	// top-level key," the behavior every field had before this existed.
	// Only meaningful for output fields.
	Path string
}

// fieldExtensions reads the x-mill-alias/x-mill-path vendor extensions
// off a schema -- OpenAPI's own standard x-* extension mechanism
// (confirmed directly against kin-openapi's real Schema.Extensions
// field, not assumed), not a Mill-specific hack. nil-safe: a Field
// built from a schema with no Extensions map (the overwhelming common
// case -- most specs, including every one this repo's own tests use,
// never set these) just gets zero values, identical to before this
// existed.
func fieldExtensions(ref *openapi3.SchemaRef) (alias, path string) {
	if ref == nil || ref.Value == nil || ref.Value.Extensions == nil {
		return "", ""
	}
	if v, ok := ref.Value.Extensions["x-mill-alias"].(string); ok {
		alias = v
	}
	if v, ok := ref.Value.Extensions["x-mill-path"].(string); ok {
		path = v
	}
	return alias, path
}

// Operation is one path+method's declared input/output schema.
type Operation struct {
	InputFields  []Field
	OutputFields []Field
	// ResponseExtractPath is a document-level root extraction applied
	// to the whole response *before* any per-field Path extraction
	// (docs/SPEC.md §4.1) -- e.g. an envelope like {"data":{...}} where
	// every declared field actually lives under "data". Read from the
	// x-mill-response-extract-path vendor extension on the operation
	// itself (OpenAPI's own x-* mechanism, same as Field's Alias/Path).
	// Deliberately narrower than the reference platform's own syntax
	// (no bracket-array-index or "$."-JSONPath-prefix support) --
	// reuses the exact same dot-path + numeric-segment grammar
	// extractPath (attributebinding.go) already has, rather than a
	// second parser for a grammar that was never fully specified
	// (docs/SPEC.md §10). Empty or "*" means no extraction (the
	// original, unwrapped response) -- "*" is the one reference-platform
	// example this can represent exactly, since "identity" needs no
	// real path grammar at all.
	ResponseExtractPath string
}

// Operation resolves one path+method into its declared fields. Input
// fields come from the operation's Parameters (path/query/header/
// cookie) plus its JSON request body's top-level properties, if any.
// Output fields come from the first 2xx JSON response's top-level
// properties.
func (d *Document) Operation(path, method string) (*Operation, error) {
	if d.doc.Paths == nil {
		return nil, fmt.Errorf("openapispec: spec has no paths")
	}
	item := d.doc.Paths.Find(path)
	if item == nil {
		return nil, fmt.Errorf("openapispec: no path %q in spec", path)
	}
	op := item.GetOperation(method)
	if op == nil {
		return nil, fmt.Errorf("openapispec: no %s operation at %q", method, path)
	}

	var input []Field
	for _, pref := range op.Parameters {
		if pref == nil || pref.Value == nil {
			continue
		}
		p := pref.Value
		alias, path := fieldExtensions(p.Schema)
		def, desc, enumValues := fieldSchemaExtras(p.Schema)
		input = append(input, Field{
			Field: typedfield.Field{
				Key:         p.Name,
				Label:       alias,
				Type:        schemaType(p.Schema),
				Required:    p.Required,
				Default:     def,
				Description: desc,
				Options:     enumValues,
				Secret:      isSecretField(p.Name, p.Schema),
			},
			In:   p.In,
			Path: path,
		})
	}
	if op.RequestBody != nil && op.RequestBody.Value != nil {
		input = append(input, bodyFields(op.RequestBody.Value.Content)...)
	}
	sortFields(input)

	var output []Field
	if op.Responses != nil {
		for _, code := range []string{"200", "201", "202", "204"} {
			rref := op.Responses.Value(code)
			if rref == nil || rref.Value == nil {
				continue
			}
			output = bodyFields(rref.Value.Content)
			break
		}
	}
	sortFields(output)

	responseExtractPath := ""
	if v, ok := op.Extensions["x-mill-response-extract-path"].(string); ok {
		responseExtractPath = v
	}

	return &Operation{InputFields: input, OutputFields: output, ResponseExtractPath: responseExtractPath}, nil
}

// bodyFields extracts top-level property fields from a Content map's
// JSON media type, if present -- application/json only (v1 scope, per
// ADR-0007; other media types are real future work, not silently
// mishandled -- a non-JSON body simply contributes no body fields).
func bodyFields(content openapi3.Content) []Field {
	mt, ok := content["application/json"]
	if !ok || mt.Schema == nil || mt.Schema.Value == nil {
		return nil
	}
	schema := mt.Schema.Value
	required := make(map[string]bool, len(schema.Required))
	for _, name := range schema.Required {
		required[name] = true
	}
	var out []Field
	for name, propRef := range schema.Properties {
		alias, path := fieldExtensions(propRef)
		def, desc, enumValues := fieldSchemaExtras(propRef)
		out = append(out, Field{
			Field: typedfield.Field{
				Key:         name,
				Label:       alias,
				Type:        schemaType(propRef),
				Required:    required[name],
				Default:     def,
				Description: desc,
				Options:     enumValues,
				Secret:      isSecretField(name, propRef),
			},
			In:   "body",
			Path: path,
		})
	}
	return out
}

// schemaType maps a schema's declared OpenAPI type/format into Mill's
// canonical typedfield.Type vocabulary (ADR-0029 Phase 3) -- the
// Mill<->OpenAPI translation boundary this package's own doc comment
// already promised, extended here with "string"->TypeText (OpenAPI's
// document keywords stay OpenAPI's own -- "string," never "text" --
// only Mill's in-memory Field uses typedfield.Type). "map" and
// "date"/"datetime" were already the three additions beyond the
// original 6 (string/number/integer/boolean/object/array), per
// docs/SPEC.md §4.1's capability map: OpenAPI has no dedicated "map"
// keyword -- the real, standard idiom (confirmed directly against the
// spec, not assumed) is `type: object` with `additionalProperties` set
// and no fixed `properties` -- and date/date-time are the two standard
// `format` values on a `type: string` schema (RFC 3339), not a new
// `type` of their own. Every other OpenAPI type keyword
// (number/integer/boolean/array) is already byte-identical to its
// typedfield.Type constant, so the default branch is a plain
// same-string conversion, not a lookup table.
func schemaType(ref *openapi3.SchemaRef) typedfield.Type {
	if ref == nil || ref.Value == nil || ref.Value.Type == nil {
		return typedfield.TypeText
	}
	s := ref.Value.Type.Slice()
	if len(s) == 0 {
		return typedfield.TypeText
	}
	switch s[0] {
	case "string":
		switch ref.Value.Format {
		case "date":
			return typedfield.TypeDate
		case "date-time":
			return typedfield.TypeDatetime
		default:
			return typedfield.TypeText
		}
	case "object":
		ap := ref.Value.AdditionalProperties
		if len(ref.Value.Properties) == 0 && (ap.Schema != nil || (ap.Has != nil && *ap.Has)) {
			return typedfield.TypeMap
		}
		return typedfield.TypeObject
	default:
		return typedfield.Type(s[0])
	}
}

// fieldSchemaExtras reads default/description/enum straight off the
// schema -- unlike Alias/Path (docs/adr/0011), these are OpenAPI's own
// standard keywords, no x-mill-* vendor extension needed. Default is
// stringified (Default is `any` on the underlying schema; Mill's own
// config/binding values are uniformly strings on the wire) -- nil-safe,
// same "a schema with none of these just gets zero values" shape
// fieldExtensions already established.
func fieldSchemaExtras(ref *openapi3.SchemaRef) (defaultVal, description string, enumValues []string) {
	if ref == nil || ref.Value == nil {
		return "", "", nil
	}
	if ref.Value.Default != nil {
		defaultVal = fmt.Sprintf("%v", ref.Value.Default)
	}
	description = ref.Value.Description
	for _, v := range ref.Value.Enum {
		enumValues = append(enumValues, fmt.Sprintf("%v", v))
	}
	return defaultVal, description, enumValues
}

func isSecretField(name string, ref *openapi3.SchemaRef) bool {
	if ref != nil && ref.Value != nil && ref.Value.Format == "password" {
		return true
	}
	// Normalized (no "-"/"_") so "X-Api-Key" and "api_key" both match
	// the same "apikey" needle -- a real gap the test suite here caught
	// directly (X-Api-Key failed the naive strings.Contains check).
	n := strings.NewReplacer("-", "", "_", "").Replace(strings.ToLower(name))
	for _, needle := range []string{"secret", "password", "token", "apikey", "authorization"} {
		if strings.Contains(n, needle) {
			return true
		}
	}
	return false
}

func sortFields(fields []Field) {
	sort.Slice(fields, func(i, j int) bool { return fields[i].Key < fields[j].Key })
}

// BuildRequest assembles a path/query/headers/body from an Operation's
// declared InputFields and a flat map of raw string values keyed by
// field Name -- the "test this operation with example values" case
// (docs/adr/0013), distinct from composition/attributebinding.go's
// resolveInputBindings (which resolves a workflow node's authored
// Attribute-bindings config against a running ExecContext, not a flat
// value map). A field with no entry in values is simply omitted --
// callers decide what "required but missing" means for their own case,
// this function doesn't enforce Required itself.
func BuildRequest(pathTemplate string, op *Operation, values map[string]string) (resolvedPath string, query url.Values, headers map[string]string, body string, err error) {
	resolvedPath = pathTemplate
	query = url.Values{}
	headers = map[string]string{}
	bodyObj := map[string]any{}

	for _, f := range op.InputFields {
		raw, ok := values[f.Key]
		if !ok {
			continue
		}
		switch f.In {
		case "path":
			resolvedPath = strings.ReplaceAll(resolvedPath, "{"+f.Key+"}", raw)
		case "query":
			query.Set(f.Key, raw)
		case "header":
			headers[f.Key] = raw
		default: // "body" (and any other placement kin-openapi never emits today)
			bodyObj[f.Key] = coerceValue(f.Type, raw)
		}
	}

	if len(bodyObj) > 0 {
		data, mErr := json.Marshal(bodyObj)
		if mErr != nil {
			return "", nil, nil, "", fmt.Errorf("openapispec: build request body: %w", mErr)
		}
		body = string(data)
	}
	return resolvedPath, query, headers, body, nil
}

// coerceValue turns a field's raw string value into the JSON type its
// declared OpenAPI Type implies, so a generated/typed "42" lands in the
// request body as the number 42, not the string "42" -- a real
// difference for an API that validates its own request schema strictly.
// Falls back to the raw string on a parse failure (a hand-edited test
// value that doesn't actually match its declared type) rather than
// failing the whole request -- the real API is the actual validator
// here, not this function.
func coerceValue(fieldType typedfield.Type, raw string) any {
	switch fieldType {
	case typedfield.TypeNumber:
		if v, err := strconv.ParseFloat(raw, 64); err == nil {
			return v
		}
	case typedfield.TypeInteger:
		if v, err := strconv.ParseInt(raw, 10, 64); err == nil {
			return v
		}
	case typedfield.TypeBoolean:
		if v, err := strconv.ParseBool(raw); err == nil {
			return v
		}
	}
	return raw
}
