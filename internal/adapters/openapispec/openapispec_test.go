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
		byName[f.Name] = f
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
	if !apiKey.IsSecret {
		t.Error("X-Api-Key field.IsSecret = false, want true (name-based heuristic)")
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
		byName[f.Name] = f
	}

	status, ok := byName["status"]
	if !ok || !status.Required || status.IsSecret {
		t.Errorf("status field = %+v, want Required=true IsSecret=false", status)
	}
	token, ok := byName["sessionToken"]
	if !ok || !token.IsSecret {
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
		if f.Name == "quantity" {
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

	if len(op.InputFields) != 1 || op.InputFields[0].Alias != "widgetId" {
		t.Errorf("InputFields = %+v, want one field with Alias=widgetId", op.InputFields)
	}

	byName := make(map[string]Field, len(op.OutputFields))
	for _, f := range op.OutputFields {
		byName[f.Name] = f
	}
	n, ok := byName["n"]
	if !ok || n.Alias != "widgetName" || n.Path != "data.name" {
		t.Errorf("field %q = %+v, want Alias=widgetName Path=data.name", "n", n)
	}
	plain, ok := byName["plain"]
	if !ok || plain.Alias != "" || plain.Path != "" {
		t.Errorf("field %q = %+v, want empty Alias/Path (no extension set, backward compatible)", "plain", plain)
	}
}
