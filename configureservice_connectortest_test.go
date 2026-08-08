package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicoding/mill/internal/domain/connector"
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

func TestTestConnectorOperation_UsesDraftValues_NotAConnectorID(t *testing.T) {
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
	result, err := cfg.TestConnectorOperation(TestConnectorRequest{
		BaseURL:     srv.URL,
		AuthType:    connector.AuthNone,
		OpenAPISpec: testOpenAPISpecWithParams,
		Path:        "/widgets/{id}",
		Method:      http.MethodPost,
		Values:      map[string]string{"id": "abc", "verbose": "true", "name": "widget-1"},
	})
	if err != nil {
		t.Fatalf("TestConnectorOperation returned error: %v", err)
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

func TestTestConnectorOperation_FallsBackToKeychainSecret_WhenSecretBlank(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector("My API", connector.TypeHTTP, srv.URL, connector.AuthBearer, nil, testOpenAPISpec, nil, nil)
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}
	if err := cfg.SetConnectorSecret(conn.ID, "stored-secret"); err != nil {
		t.Fatalf("SetConnectorSecret returned error: %v", err)
	}

	if _, err := cfg.TestConnectorOperation(TestConnectorRequest{
		ConnectorID: conn.ID,
		BaseURL:     srv.URL,
		AuthType:    connector.AuthBearer,
		Secret:      "", // blank -- must fall back to the stored keychain secret
		OpenAPISpec: testOpenAPISpec,
		Path:        "/widgets",
		Method:      http.MethodGet,
	}); err != nil {
		t.Fatalf("TestConnectorOperation returned error: %v", err)
	}
	if gotAuth != "Bearer stored-secret" {
		t.Errorf("server received Authorization %q, want Bearer stored-secret", gotAuth)
	}
}

func TestTestConnectorOperation_ExplicitSecretOverridesKeychain(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector("My API", connector.TypeHTTP, srv.URL, connector.AuthBearer, nil, testOpenAPISpec, nil, nil)
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}
	if err := cfg.SetConnectorSecret(conn.ID, "stored-secret"); err != nil {
		t.Fatalf("SetConnectorSecret returned error: %v", err)
	}

	if _, err := cfg.TestConnectorOperation(TestConnectorRequest{
		ConnectorID: conn.ID,
		BaseURL:     srv.URL,
		AuthType:    connector.AuthBearer,
		Secret:      "typed-secret",
		OpenAPISpec: testOpenAPISpec,
		Path:        "/widgets",
		Method:      http.MethodGet,
	}); err != nil {
		t.Fatalf("TestConnectorOperation returned error: %v", err)
	}
	if gotAuth != "Bearer typed-secret" {
		t.Errorf("server received Authorization %q, want Bearer typed-secret (explicit Secret must win over keychain)", gotAuth)
	}
}

func TestTestConnectorOperation_NeverPersistsTheSecret(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector("My API", connector.TypeHTTP, srv.URL, connector.AuthBearer, nil, testOpenAPISpec, nil, nil)
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}
	if _, err := cfg.TestConnectorOperation(TestConnectorRequest{
		ConnectorID: conn.ID,
		BaseURL:     srv.URL,
		AuthType:    connector.AuthBearer,
		Secret:      "never-should-be-stored",
		OpenAPISpec: testOpenAPISpec,
		Path:        "/widgets",
		Method:      http.MethodGet,
	}); err != nil {
		t.Fatalf("TestConnectorOperation returned error: %v", err)
	}
	if _, err := cfg.resolveConnector(conn.ID); err == nil {
		t.Error("resolveConnector succeeded after only a test call (no SetConnectorSecret) -- TestConnectorOperation must not persist the secret")
	}
}

func TestTestConnectorOperation_InvalidSpec_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.TestConnectorOperation(TestConnectorRequest{
		BaseURL: "https://example.com", OpenAPISpec: "not a spec", Path: "/x", Method: http.MethodGet,
	}); err == nil {
		t.Fatal("TestConnectorOperation with an invalid OpenAPISpec returned nil error, want an error")
	}
}

func TestTestConnectorOperation_UnknownOperation_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.TestConnectorOperation(TestConnectorRequest{
		BaseURL: "https://example.com", OpenAPISpec: testOpenAPISpec, Path: "/nope", Method: http.MethodGet,
	}); err == nil {
		t.Fatal("TestConnectorOperation on an operation the spec doesn't declare returned nil error, want an error")
	}
}
