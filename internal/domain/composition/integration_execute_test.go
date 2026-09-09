package composition

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicoding/mill/internal/domain/httprequest"
)

// integrationExecuteSpec declares two operations on one HTTPRequest,
// mirroring goal 0374's real shape: a search-like GET with a query
// param, and an item-scoped POST with a path param and a JSON body
// field -- enough to prove ExecuteOperation resolves BOTH a query and
// a path/body operation through the shared tail.
const integrationExecuteSpec = `{
  "openapi": "3.0.3",
  "info": {"title": "Tracked items", "version": "1.0.0"},
  "paths": {
    "/search": {
      "get": {
        "operationId": "search",
        "parameters": [
          {"name": "q", "in": "query", "required": false, "schema": {"type": "string"}}
        ],
        "responses": {"200": {"description": "OK"}}
      }
    },
    "/items/{itemKey}/comments": {
      "post": {
        "operationId": "addComment",
        "parameters": [
          {"name": "itemKey", "in": "path", "required": true, "schema": {"type": "string"}}
        ],
        "requestBody": {
          "required": true,
          "content": {"application/json": {"schema": {"type": "object", "properties": {"body": {"type": "string"}}}}}
        },
        "responses": {"200": {"description": "OK"}}
      }
    }
  }
}`

// TestExecuteOperation_SharesAuthAndURLJoinWithIntegrationHTTP proves
// goal 0374's amendment 2: ExecuteOperation (the plugin's non-workflow
// door) and the integration-http node (the workflow door) resolve the
// SAME HTTPRequest through the SAME auth/URL-join tail -- one execution
// core, two callers, never a second HTTP path.
func TestExecuteOperation_SharesAuthAndURLJoinWithIntegrationHTTP(t *testing.T) {
	var gotPath, gotQuery, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.Query().Get("q")
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	withHTTPRequestLookup(t, func(string) (ResolvedHTTPRequest, error) {
		return ResolvedHTTPRequest{BaseURL: srv.URL, OpenAPISpec: integrationExecuteSpec, AuthType: httprequest.AuthBearer, Secret: "tok"}, nil
	})

	// The plugin's own door.
	body, err := ExecuteOperation("conn-1", "/search", http.MethodGet, map[string]string{"q": "assignee = me"}, SecretAccessRun{})
	if err != nil {
		t.Fatalf("ExecuteOperation returned error: %v", err)
	}
	if body != `{"ok":true}` {
		t.Errorf("ExecuteOperation body = %q, want the response body", body)
	}
	if gotPath != "/search" {
		t.Errorf("server received path %q, want /search", gotPath)
	}
	if gotQuery != "assignee = me" {
		t.Errorf("server received q=%q, want the filter text", gotQuery)
	}
	if gotAuth != "Bearer tok" {
		t.Errorf("server received Authorization %q, want Bearer tok", gotAuth)
	}

	// The workflow's own door, same lookup, same server: identical auth.
	gotAuth = ""
	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "integration-http",
		Config:     map[string]string{"requestId": "conn-1", "path": "/search", "method": http.MethodGet},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if _, err := ExecuteWorkflow(nodes, nil, nil); err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if gotAuth != "Bearer tok" {
		t.Errorf("integration-http received Authorization %q, want Bearer tok (same tail as ExecuteOperation)", gotAuth)
	}
}

// TestExecuteOperation_PathParamAndBody proves a path parameter and a
// JSON body field both resolve -- the shape goal 0374's transition/
// comment writes need.
func TestExecuteOperation_PathParamAndBody(t *testing.T) {
	var gotPath, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		buf := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(buf)
		gotBody = string(buf)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	withHTTPRequestLookup(t, func(string) (ResolvedHTTPRequest, error) {
		return ResolvedHTTPRequest{BaseURL: srv.URL, OpenAPISpec: integrationExecuteSpec}, nil
	})

	_, err := ExecuteOperation("conn-1", "/items/{itemKey}/comments", http.MethodPost, map[string]string{"itemKey": "PROJ-1", "body": "on it"}, SecretAccessRun{})
	if err != nil {
		t.Fatalf("ExecuteOperation returned error: %v", err)
	}
	if gotPath != "/items/PROJ-1/comments" {
		t.Errorf("server received path %q, want /items/PROJ-1/comments", gotPath)
	}
	if gotBody != `{"body":"on it"}` {
		t.Errorf("server received body %q, want the JSON comment body", gotBody)
	}
}

// TestExecuteOperation_NoOpenAPISpec_Errors proves a request with no
// declared operations refuses loudly rather than silently no-op'ing.
func TestExecuteOperation_NoOpenAPISpec_Errors(t *testing.T) {
	withHTTPRequestLookup(t, func(string) (ResolvedHTTPRequest, error) {
		return ResolvedHTTPRequest{BaseURL: "https://example.invalid"}, nil
	})
	if _, err := ExecuteOperation("conn-1", "/search", http.MethodGet, nil, SecretAccessRun{}); err == nil {
		t.Fatal("ExecuteOperation returned no error for a request with no OpenAPI spec")
	}
}
