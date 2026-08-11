package openapispec

import "testing"

// A real, minimal OpenAPI 3.0 document -- one path, two operations,
// path/query/header parameters, a JSON request body, and a JSON
// response body including a password-formatted field -- exercised
// against the real kin-openapi parser/validator, not a hand-built
// fixture struct.
const sampleSpec = `{
  "openapi": "3.0.3",
  "info": {"title": "Sample API", "version": "1.0.0"},
  "paths": {
    "/orders/{orderId}": {
      "get": {
        "summary": "Get an order",
        "parameters": [
          {"name": "orderId", "in": "path", "required": true, "schema": {"type": "string"}},
          {"name": "verbose", "in": "query", "required": false, "schema": {"type": "boolean"}},
          {"name": "X-Api-Key", "in": "header", "required": true, "schema": {"type": "string"}}
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "required": ["status"],
                  "properties": {
                    "status": {"type": "string"},
                    "total": {"type": "number"},
                    "sessionToken": {"type": "string", "format": "password"}
                  }
                }
              }
            }
          }
        }
      },
      "post": {
        "summary": "Update an order",
        "parameters": [
          {"name": "orderId", "in": "path", "required": true, "schema": {"type": "string"}}
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["quantity"],
                "properties": {
                  "quantity": {"type": "integer"},
                  "note": {"type": "string"}
                }
              }
            }
          }
        },
        "responses": {
          "204": {"description": "No content"}
        }
      }
    }
  }
}`

func TestParse_ValidDocument(t *testing.T) {
	if _, err := Parse([]byte(sampleSpec)); err != nil {
		t.Fatalf("Parse: %v", err)
	}
}

func TestParse_InvalidDocument_Errors(t *testing.T) {
	if _, err := Parse([]byte(`{"not": "a spec"}`)); err == nil {
		t.Fatal("Parse on a non-OpenAPI document: want error, got nil")
	}
}

func TestOperations_ListsBothMethods(t *testing.T) {
	doc, err := Parse([]byte(sampleSpec))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	ops := doc.Operations()
	if len(ops) != 2 {
		t.Fatalf("Operations() = %d entries, want 2: %+v", len(ops), ops)
	}
	if ops[0].Method != "GET" || ops[1].Method != "POST" {
		t.Errorf("Operations() methods = [%s, %s], want [GET, POST] (stable order)", ops[0].Method, ops[1].Method)
	}
	if ops[0].Path != "/orders/{orderId}" {
		t.Errorf("Operations()[0].Path = %q, want /orders/{orderId}", ops[0].Path)
	}
}

func TestOperation_GET_InputFields_HavePlacementAndSecretFlag(t *testing.T) {
	doc, err := Parse([]byte(sampleSpec))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	op, err := doc.Operation("/orders/{orderId}", "GET")
	if err != nil {
		t.Fatalf("Operation: %v", err)
	}
	if len(op.InputFields) != 3 {
		t.Fatalf("InputFields = %d, want 3: %+v", len(op.InputFields), op.InputFields)
	}

	byName := make(map[string]Field, len(op.InputFields))
	for _, f := range op.InputFields {
		byName[f.Key] = f
	}

	orderID, ok := byName["orderId"]
	if !ok || orderID.In != "path" || !orderID.Required {
		t.Errorf("orderId field = %+v, want In=path Required=true", orderID)
	}
	verbose, ok := byName["verbose"]
	if !ok || verbose.In != "query" || verbose.Required {
		t.Errorf("verbose field = %+v, want In=query Required=false", verbose)
	}
	apiKey, ok := byName["X-Api-Key"]
	if !ok || apiKey.In != "header" {
		t.Errorf("X-Api-Key field = %+v, want In=header", apiKey)
	}
	if !apiKey.Secret {
		t.Error("X-Api-Key field.Secret = false, want true (name-based heuristic)")
	}
}

func TestOperation_GET_OutputFields_PasswordFormatIsSecret(t *testing.T) {
	doc, err := Parse([]byte(sampleSpec))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	op, err := doc.Operation("/orders/{orderId}", "GET")
	if err != nil {
		t.Fatalf("Operation: %v", err)
	}
	if len(op.OutputFields) != 3 {
		t.Fatalf("OutputFields = %d, want 3: %+v", len(op.OutputFields), op.OutputFields)
	}

	byName := make(map[string]Field, len(op.OutputFields))
	for _, f := range op.OutputFields {
		byName[f.Key] = f
	}

	status, ok := byName["status"]
	if !ok || !status.Required || status.Secret {
		t.Errorf("status field = %+v, want Required=true IsSecret=false", status)
	}
	token, ok := byName["sessionToken"]
	if !ok || !token.Secret {
		t.Errorf("sessionToken field = %+v, want IsSecret=true (format: password)", token)
	}
}

func TestOperation_POST_RequestBodyFields(t *testing.T) {
	doc, err := Parse([]byte(sampleSpec))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	op, err := doc.Operation("/orders/{orderId}", "POST")
	if err != nil {
		t.Fatalf("Operation: %v", err)
	}
	// 1 path param (orderId) + 2 body fields (quantity, note).
	if len(op.InputFields) != 3 {
		t.Fatalf("InputFields = %d, want 3: %+v", len(op.InputFields), op.InputFields)
	}
	var sawQuantity bool
	for _, f := range op.InputFields {
		if f.Key == "quantity" {
			sawQuantity = true
			if f.In != "body" || f.Type != "integer" || !f.Required {
				t.Errorf("quantity field = %+v, want In=body Type=integer Required=true", f)
			}
		}
	}
	if !sawQuantity {
		t.Error("InputFields missing quantity (request body field)")
	}
	// 204 No Content -- no response body, so no output fields.
	if len(op.OutputFields) != 0 {
		t.Errorf("OutputFields = %+v, want none (204 No Content)", op.OutputFields)
	}
}

func TestOperation_UnknownPath_Errors(t *testing.T) {
	doc, err := Parse([]byte(sampleSpec))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if _, err := doc.Operation("/nope", "GET"); err == nil {
		t.Fatal("Operation on an unknown path: want error, got nil")
	}
}

func TestOperation_UnknownMethod_Errors(t *testing.T) {
	doc, err := Parse([]byte(sampleSpec))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if _, err := doc.Operation("/orders/{orderId}", "DELETE"); err == nil {
		t.Fatal("Operation on a method the spec doesn't declare: want error, got nil")
	}
}

// docs/adr/0011: x-mill-alias/x-mill-path are OpenAPI's own standard
// x-* vendor extension mechanism -- exercised against a real parsed
// document, not asserted from kin-openapi's type shape alone.
const aliasPathSpec = `{
  "openapi": "3.0.3",
  "info": {"title": "Alias Sample", "version": "1.0.0"},
  "paths": {
    "/widgets/{id}": {
      "get": {
        "parameters": [
          {"name": "id", "in": "path", "required": true, "schema": {"type": "string", "x-mill-alias": "widgetId"}}
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {"application/json": {"schema": {"type": "object", "properties": {
              "n": {"type": "string", "x-mill-alias": "widgetName", "x-mill-path": "data.name"},
              "plain": {"type": "string"}
            }}}}
          }
        }
      }
    }
  }
}`

func TestOperation_AliasAndPathExtensions_Extracted(t *testing.T) {
	doc, err := Parse([]byte(aliasPathSpec))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	op, err := doc.Operation("/widgets/{id}", "GET")
	if err != nil {
		t.Fatalf("Operation: %v", err)
	}

	if len(op.InputFields) != 1 || op.InputFields[0].Label != "widgetId" {
		t.Errorf("InputFields = %+v, want one field with Alias=widgetId", op.InputFields)
	}

	byName := make(map[string]Field, len(op.OutputFields))
	for _, f := range op.OutputFields {
		byName[f.Key] = f
	}
	n, ok := byName["n"]
	if !ok || n.Label != "widgetName" || n.Path != "data.name" {
		t.Errorf("field %q = %+v, want Alias=widgetName Path=data.name", "n", n)
	}
	plain, ok := byName["plain"]
	if !ok || plain.Label != "" || plain.Path != "" {
		t.Errorf("field %q = %+v, want empty Alias/Path (no extension set, backward compatible)", "plain", plain)
	}
}

func TestBuildRequest_PathQueryHeader_PlacedCorrectly(t *testing.T) {
	doc, err := Parse([]byte(sampleSpec))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	op, err := doc.Operation("/orders/{orderId}", "GET")
	if err != nil {
		t.Fatalf("Operation: %v", err)
	}

	path, query, headers, body, err := BuildRequest("/orders/{orderId}", op, map[string]string{
		"orderId":   "abc123",
		"verbose":   "true",
		"X-Api-Key": "should-be-a-header-not-a-query-param",
	})
	if err != nil {
		t.Fatalf("BuildRequest: %v", err)
	}
	if path != "/orders/abc123" {
		t.Errorf("path = %q, want /orders/abc123 (placeholder substituted)", path)
	}
	if query.Get("verbose") != "true" {
		t.Errorf("query[verbose] = %q, want true", query.Get("verbose"))
	}
	if query.Get("orderId") != "" || query.Get("X-Api-Key") != "" {
		t.Errorf("query = %+v, path/header fields must not leak into the query string", query)
	}
	if headers["X-Api-Key"] != "should-be-a-header-not-a-query-param" {
		t.Errorf("headers[X-Api-Key] = %q, want the header value", headers["X-Api-Key"])
	}
	if body != "" {
		t.Errorf("body = %q, want empty (GET has no body fields)", body)
	}
}

func TestBuildRequest_BodyFields_CoercedAndOmittedWhenMissing(t *testing.T) {
	doc, err := Parse([]byte(sampleSpec))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	op, err := doc.Operation("/orders/{orderId}", "POST")
	if err != nil {
		t.Fatalf("Operation: %v", err)
	}

	// "note" deliberately omitted -- BuildRequest doesn't enforce
	// Required, only includes what's present in values.
	path, _, _, body, err := BuildRequest("/orders/{orderId}", op, map[string]string{
		"orderId":  "abc123",
		"quantity": "3",
	})
	if err != nil {
		t.Fatalf("BuildRequest: %v", err)
	}
	if path != "/orders/abc123" {
		t.Errorf("path = %q, want /orders/abc123", path)
	}
	if body != `{"quantity":3}` {
		t.Errorf("body = %q, want quantity coerced to a JSON number and note omitted", body)
	}
}

// docs/SPEC.md §4.1: Default/Description (OpenAPI's own standard
// keywords) and the map/date/datetime type additions.
const richFieldSpec = `{
  "openapi": "3.0.3",
  "info": {"title": "Rich Fields", "version": "1.0.0"},
  "paths": {
    "/widgets": {
      "post": {
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "status": {"type": "string", "description": "current status", "default": "pending", "enum": ["pending", "active", "closed"]},
                  "retries": {"type": "integer", "default": 3},
                  "metadata": {"type": "object", "additionalProperties": {"type": "string"}},
                  "createdOn": {"type": "string", "format": "date"},
                  "updatedAt": {"type": "string", "format": "date-time"},
                  "tags": {"type": "object", "properties": {"primary": {"type": "string"}}}
                }
              }
            }
          }
        },
        "responses": {"200": {"description": "OK"}}
      }
    }
  }
}`

func TestOperation_DefaultDescriptionEnum_Extracted(t *testing.T) {
	doc, err := Parse([]byte(richFieldSpec))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	op, err := doc.Operation("/widgets", "POST")
	if err != nil {
		t.Fatalf("Operation: %v", err)
	}
	byName := make(map[string]Field, len(op.InputFields))
	for _, f := range op.InputFields {
		byName[f.Key] = f
	}

	status, ok := byName["status"]
	if !ok || status.Description != "current status" || status.Default != "pending" {
		t.Errorf("status = %+v, want Description=%q Default=%q", status, "current status", "pending")
	}
	wantEnum := []string{"pending", "active", "closed"}
	if len(status.Options) != len(wantEnum) {
		t.Fatalf("status.Options = %v, want %v", status.Options, wantEnum)
	}
	for i, v := range wantEnum {
		if status.Options[i] != v {
			t.Errorf("status.Options[%d] = %q, want %q", i, status.Options[i], v)
		}
	}

	retries, ok := byName["retries"]
	if !ok || retries.Default != "3" {
		t.Errorf("retries = %+v, want Default=3", retries)
	}
}

func TestOperation_MapDateDatetimeTypes_Extracted(t *testing.T) {
	doc, err := Parse([]byte(richFieldSpec))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	op, err := doc.Operation("/widgets", "POST")
	if err != nil {
		t.Fatalf("Operation: %v", err)
	}
	byName := make(map[string]Field, len(op.InputFields))
	for _, f := range op.InputFields {
		byName[f.Key] = f
	}

	if got := byName["metadata"].Type; got != "map" {
		t.Errorf(`metadata.Type = %q, want "map" (object with additionalProperties, no fixed properties)`, got)
	}
	if got := byName["createdOn"].Type; got != "date" {
		t.Errorf(`createdOn.Type = %q, want "date"`, got)
	}
	if got := byName["updatedAt"].Type; got != "datetime" {
		t.Errorf(`updatedAt.Type = %q, want "datetime"`, got)
	}
	// A fixed-shape object (real `properties`, no additionalProperties)
	// must still resolve to "object", not "map" -- the distinguishing
	// signal is "no fixed properties," not "type: object" alone.
	if got := byName["tags"].Type; got != "object" {
		t.Errorf(`tags.Type = %q, want "object" (has fixed properties, not a map)`, got)
	}
}
