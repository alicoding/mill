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
	"fmt"
	"net/http"
	"sort"
	"strings"

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

// Field is one declared input or output field of an Operation.
type Field struct {
	Name     string
	In       string // "path" | "query" | "header" | "cookie" | "body"
	Type     string // "string" | "number" | "integer" | "boolean" | "object" | "array"
	Required bool
	// IsSecret flags a field composition.ValidateGraph's save-time
	// guardrail (ADR-0007) refuses to let a workflow bind into an
	// output Attribute -- true when the field's schema declares the
	// OpenAPI-standard `format: "password"` (the spec's own documented
	// convention for "mask this in a UI"), or its name looks
	// secret-shaped (token/secret/password/apikey/authorization) as a
	// defensive fallback for specs that don't bother with the format
	// annotation. Applies uniformly to input and output fields -- a
	// response can legitimately echo a sensitive field too.
	IsSecret bool
}

// Operation is one path+method's declared input/output schema.
type Operation struct {
	InputFields  []Field
	OutputFields []Field
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
		input = append(input, Field{
			Name:     p.Name,
			In:       p.In,
			Type:     schemaType(p.Schema),
			Required: p.Required,
			IsSecret: isSecretField(p.Name, p.Schema),
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

	return &Operation{InputFields: input, OutputFields: output}, nil
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
		out = append(out, Field{
			Name:     name,
			In:       "body",
			Type:     schemaType(propRef),
			Required: required[name],
			IsSecret: isSecretField(name, propRef),
		})
	}
	return out
}

func schemaType(ref *openapi3.SchemaRef) string {
	if ref == nil || ref.Value == nil || ref.Value.Type == nil {
		return "string"
	}
	if s := ref.Value.Type.Slice(); len(s) > 0 {
		return s[0]
	}
	return "string"
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
	sort.Slice(fields, func(i, j int) bool { return fields[i].Name < fields[j].Name })
}
