package configuresvc

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/httprequest"
)

const testOpenAPISpecWithParams = `{
  "openapi": "3.0.3",
  "info": {"title": "Test", "version": "1.0.0"},
  "paths": {
    "/widgets/{id}": {
      "post": {
        "parameters": [
          {"name": "id", "in": "path", "required": true, "schema": {"type": "string"}},
          {"name": "verbose", "in": "query", "required": false, "schema": {"type": "boolean"}}
        ],
        "requestBody": {
          "required": true,
          "content": {"application/json": {"schema": {"type": "object", "properties": {
            "name": {"type": "string"}
          }}}}
        },
        "responses": {"200": {"description": "OK"}}
      }
    }
  }
}`

func TestTestHTTPRequestOperation_UsesDraftValues_NotARequestID(t *testing.T) {
	var gotPath, gotQuery, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		body := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(body)
		gotBody = string(body)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	cfg, _ := newTestConfigureService(t)
	result, err := cfg.TestHTTPRequestOperation(TestHTTPRequestInput{
		BaseURL:     srv.URL,
		AuthType:    httprequest.AuthNone,
		OpenAPISpec: testOpenAPISpecWithParams,
		Path:        "/widgets/{id}",
		Method:      http.MethodPost,
		Values:      map[string]string{"id": "abc", "verbose": "true", "name": "widget-1"},
	})
	if err != nil {
		t.Fatalf("TestHTTPRequestOperation returned error: %v", err)
	}
	if gotPath != "/widgets/abc" {
		t.Errorf("server received path %q, want /widgets/abc", gotPath)
	}
	if gotQuery != "verbose=true" {
		t.Errorf("server received query %q, want verbose=true", gotQuery)
	}
	if gotBody != `{"name":"widget-1"}` {
		t.Errorf("server received body %q, want {\"name\":\"widget-1\"}", gotBody)
	}
	if result.StatusCode != http.StatusCreated || result.Body != `{"ok":true}` {
		t.Errorf("result = %+v, want StatusCode=201 Body={\"ok\":true}", result)
	}
	if result.Error != "" {
		t.Errorf("result.Error = %q, want empty", result.Error)
	}
}

// A test call resolves the SAME reference a real run would (goal
// 0306), so what a test proves is what will happen.
func TestTestHTTPRequestOperation_ResolvesTheReferenceItIsGiven(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	cfg, _ := newTestConfigureService(t)
	req, err := cfg.CreateHTTPRequest("My API", srv.URL, "", "", httprequest.AuthBearer, "", nil, testOpenAPISpec, nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest returned error: %v", err)
	}
	storeRequestSecret(t, cfg, req.ID, "stored-secret")

	if _, err := cfg.TestHTTPRequestOperation(TestHTTPRequestInput{
		RequestID:   req.ID,
		BaseURL:     srv.URL,
		AuthType:    httprequest.AuthBearer,
		SecretRef:   requestSecretRef(t, cfg, req.ID),
		OpenAPISpec: testOpenAPISpec,
		Path:        "/widgets",
		Method:      http.MethodGet,
	}); err != nil {
		t.Fatalf("TestHTTPRequestOperation returned error: %v", err)
	}
	if gotAuth != "Bearer stored-secret" {
		t.Errorf("server received Authorization %q, want Bearer stored-secret", gotAuth)
	}
}

// A draft may point at any entry, not only the one the saved request
// names -- which is how a user tests a replacement credential before
// committing to it.
func TestTestHTTPRequestOperation_ADifferentReferenceIsUsedAsGiven(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	cfg, _ := newTestConfigureService(t)
	req, err := cfg.CreateHTTPRequest("My API", srv.URL, "", "", httprequest.AuthBearer, "", nil, testOpenAPISpec, nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest returned error: %v", err)
	}
	storeRequestSecret(t, cfg, req.ID, "stored-secret")

	if _, err := cfg.TestHTTPRequestOperation(TestHTTPRequestInput{
		RequestID:   req.ID,
		BaseURL:     srv.URL,
		AuthType:    httprequest.AuthBearer,
		SecretRef:   secretStoreOf(t, cfg).Put("A replacement token", "typed-secret"),
		OpenAPISpec: testOpenAPISpec,
		Path:        "/widgets",
		Method:      http.MethodGet,
	}); err != nil {
		t.Fatalf("TestHTTPRequestOperation returned error: %v", err)
	}
	if gotAuth != "Bearer typed-secret" {
		t.Errorf("server received Authorization %q, want Bearer typed-secret (the draft's own reference must be the one used)", gotAuth)
	}
}

// Testing a draft never saves anything onto the request: the request
// still names no secret afterwards.
func TestTestHTTPRequestOperation_NeverPersistsTheReference(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	cfg, _ := newTestConfigureService(t)
	req, err := cfg.CreateHTTPRequest("My API", srv.URL, "", "", httprequest.AuthBearer, "", nil, testOpenAPISpec, nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest returned error: %v", err)
	}
	if _, err := cfg.TestHTTPRequestOperation(TestHTTPRequestInput{
		RequestID:   req.ID,
		BaseURL:     srv.URL,
		AuthType:    httprequest.AuthBearer,
		SecretRef:   secretStoreOf(t, cfg).Put("A draft-only token", "never-should-be-stored"),
		OpenAPISpec: testOpenAPISpec,
		Path:        "/widgets",
		Method:      http.MethodGet,
	}); err != nil {
		t.Fatalf("TestHTTPRequestOperation returned error: %v", err)
	}
	if _, err := cfg.resolveHTTPRequest(req.ID, composition.SecretAccessRun{}); err == nil {
		t.Error("resolveHTTPRequest succeeded after only a test call -- TestHTTPRequestOperation must not write the draft's reference onto the request")
	}
}

func TestTestHTTPRequestOperation_InvalidSpec_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.TestHTTPRequestOperation(TestHTTPRequestInput{
		BaseURL: "https://example.com", OpenAPISpec: "not a spec", Path: "/x", Method: http.MethodGet,
	}); err == nil {
		t.Fatal("TestHTTPRequestOperation with an invalid OpenAPISpec returned nil error, want an error")
	}
}

func TestTestHTTPRequestOperation_UnknownOperation_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.TestHTTPRequestOperation(TestHTTPRequestInput{
		BaseURL: "https://example.com", OpenAPISpec: testOpenAPISpec, Path: "/nope", Method: http.MethodGet,
	}); err == nil {
		t.Fatal("TestHTTPRequestOperation on an operation the spec doesn't declare returned nil error, want an error")
	}
}
