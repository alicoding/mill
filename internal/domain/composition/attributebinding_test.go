package composition

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// One operation exercising every input placement (path/query/header/
// body) plus a response with one plain and one secret-classified output
// field -- shared across ADR-0007 Phase 3's binding tests below.
const bindingTestSpec = `{
  "openapi": "3.0.3",
  "info": {"title": "t", "version": "1"},
  "paths": {
    "/widgets/{id}": {
      "post": {
        "parameters": [
          {"name": "id", "in": "path", "required": true, "schema": {"type": "string"}},
          {"name": "verbose", "in": "query", "schema": {"type": "string"}},
          {"name": "X-Trace-Id", "in": "header", "schema": {"type": "string"}}
        ],
        "requestBody": {
          "content": {"application/json": {"schema": {"type": "object", "properties": {
            "note": {"type": "string"}
          }}}}
        },
        "responses": {
          "200": {
            "description": "ok",
            "content": {"application/json": {"schema": {"type": "object", "properties": {
              "name": {"type": "string"},
              "token": {"type": "string", "format": "password"}
            }}}}
          }
        }
      }
    }
  }
}`

func TestExecuteWorkflow_IntegrationHTTP_InputBindings_ResolvesPathQueryHeaderBody(t *testing.T) {
	var gotPath, gotQuery, gotHeader string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.Query().Get("verbose")
		gotHeader = r.Header.Get("X-Trace-Id")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"name":"widget-1"}`))
	}))
	defer srv.Close()

	withConnectorLookup(t, func(id string) (ResolvedConnector, error) {
		return ResolvedConnector{BaseURL: srv.URL, OpenAPISpec: bindingTestSpec}, nil
	})

	inputBindings, err := json.Marshal(map[string]string{
		"id":         "w-42",         // literal
		"verbose":    "true",         // literal
		"X-Trace-Id": "attr:traceId", // attribute reference
		"note":       "attr:note",
	})
	if err != nil {
		t.Fatalf("marshal inputBindings: %v", err)
	}

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "integration-http",
		Config: map[string]string{
			"connectorId": "conn-1", "path": "/widgets/{id}", "method": http.MethodPost,
			"inputBindings": string(inputBindings),
		},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	attrs := []AttributeDef{
		{Key: "traceId", Label: "Trace ID", Type: FieldText},
		{Key: "note", Label: "Note", Type: FieldText},
	}
	if _, err := ExecuteWorkflow(nodes, nil, attrs, map[string]string{"traceId": "abc123", "note": "hello"}); err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}

	if gotPath != "/widgets/w-42" {
		t.Errorf("server received path %q, want %q (path-template substitution)", gotPath, "/widgets/w-42")
	}
	if gotQuery != "true" {
		t.Errorf("server received query verbose=%q, want %q", gotQuery, "true")
	}
	if gotHeader != "abc123" {
		t.Errorf("server received X-Trace-Id=%q, want the resolved attr:traceId value %q", gotHeader, "abc123")
	}
	if gotBody["note"] != "hello" {
		t.Errorf("server received body note=%v, want the resolved attr:note value %q", gotBody["note"], "hello")
	}
}

// Real proof the output binding actually writes ctx.Attributes, not
// just that it's parsed without error -- a downstream Decision node
// routes on the bound Attribute (same pattern
// TestExecuteWorkflow_AttrValues_OverridesZeroValueDefault already
// established for the same reason).
func TestExecuteWorkflow_IntegrationHTTP_OutputBindings_WritesAttributeAndRoutesDecision(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"name":"widget-1"}`))
	}))
	defer srv.Close()

	withConnectorLookup(t, func(id string) (ResolvedConnector, error) {
		return ResolvedConnector{BaseURL: srv.URL, OpenAPISpec: bindingTestSpec}, nil
	})

	outputBindings, err := json.Marshal(map[string]string{"name": "widgetName"})
	if err != nil {
		t.Fatalf("marshal outputBindings: %v", err)
	}

	var wroteHTML, wroteText bool
	withFakeClipboard(t, nil,
		func(string) error { wroteHTML = true; return nil },
		func(string) error { wroteText = true; return nil },
	)

	nodes, err := ResolveNodeDefaults([]Node{
		{ID: "call", NodeTypeID: "integration-http", Config: map[string]string{
			"connectorId": "conn-1", "path": "/widgets/{id}", "method": http.MethodPost,
			"inputBindings": "{}", "outputBindings": string(outputBindings),
		}},
		{ID: "d", NodeTypeID: "decision-route"},
		{ID: "yes", NodeTypeID: "apply-clipboard-write-html"},
		{ID: "no", NodeTypeID: "apply-clipboard-write-text"},
	})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	edges := []Edge{
		{ID: "call-d", Source: "call", Target: "d"},
		{ID: "d-yes", Source: "d", Target: "yes", SourceHandle: `widgetName == "widget-1"`},
		{ID: "d-no", Source: "d", Target: "no", SourceHandle: otherwiseHandle},
	}
	attrs := []AttributeDef{{Key: "widgetName", Label: "Widget name", Type: FieldText}}
	if _, err := ExecuteWorkflow(nodes, edges, attrs); err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if !wroteHTML || wroteText {
		t.Errorf("wroteHTML=%v wroteText=%v, want the Decision to route on the output-bound widgetName Attribute", wroteHTML, wroteText)
	}
}

func TestValidateGraph_IntegrationHTTP_SecretOutputBinding_Rejected(t *testing.T) {
	withConnectorLookup(t, func(id string) (ResolvedConnector, error) {
		return ResolvedConnector{OpenAPISpec: bindingTestSpec}, nil
	})
	outputBindings, _ := json.Marshal(map[string]string{"token": "leakedToken"})
	nodes, err := ResolveNodeDefaults([]Node{{
		ID: "call", NodeTypeID: "integration-http",
		Config: map[string]string{
			"connectorId": "conn-1", "path": "/widgets/{id}", "method": http.MethodPost,
			"outputBindings": string(outputBindings),
		},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if err := ValidateGraph(nodes, nil, nil); err == nil {
		t.Fatal("ValidateGraph accepted a workflow binding a secret-classified field (token) to an Attribute, want a rejection")
	}
}

func TestValidateGraph_IntegrationHTTP_NonSecretOutputBinding_Accepted(t *testing.T) {
	withConnectorLookup(t, func(id string) (ResolvedConnector, error) {
		return ResolvedConnector{OpenAPISpec: bindingTestSpec}, nil
	})
	outputBindings, _ := json.Marshal(map[string]string{"name": "widgetName"})
	nodes, err := ResolveNodeDefaults([]Node{{
		ID: "call", NodeTypeID: "integration-http",
		Config: map[string]string{
			"connectorId": "conn-1", "path": "/widgets/{id}", "method": http.MethodPost,
			"outputBindings": string(outputBindings),
		},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if err := ValidateGraph(nodes, nil, nil); err != nil {
		t.Errorf("ValidateGraph rejected a non-secret output binding: %v", err)
	}
}
