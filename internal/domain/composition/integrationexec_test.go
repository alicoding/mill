package composition

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicoding/mill/internal/domain/httprequest"
)

// integration-http's execution tests -- split out of execute_test.go
// along the node-type seam when that file crossed the 500-line limit
// (.claude/rules/architecture.md). The withHTTPRequestLookup helper
// stays in execute_test.go (same package), shared by the auth/JOSE/
// binding test files too.

func TestExecuteWorkflow_IntegrationHTTP_UsesHTTPRequestAndPath(t *testing.T) {
	var gotPath, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	withHTTPRequestLookup(t, func(id string) (ResolvedHTTPRequest, error) {
		if id != "conn-1" {
			t.Errorf("lookupHTTPRequestFn called with id %q, want %q", id, "conn-1")
		}
		return ResolvedHTTPRequest{BaseURL: srv.URL, AuthType: httprequest.AuthBearer, Secret: "tok"}, nil
	})

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "integration-http",
		Config:     map[string]string{"requestId": "conn-1", "path": "/v1/things", "method": http.MethodGet},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	result, err := ExecuteWorkflow(nodes, nil, nil)
	if err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if gotPath != "/v1/things" {
		t.Errorf("server received path %q, want %q", gotPath, "/v1/things")
	}
	if gotAuth != "Bearer tok" {
		t.Errorf("server received Authorization %q, want %q", gotAuth, "Bearer tok")
	}
	if result != `{"ok":true}` {
		t.Errorf("ExecuteWorkflow result = %q, want the response body", result)
	}
}

func TestExecuteWorkflow_IntegrationHTTP_APIKeyAuth(t *testing.T) {
	var gotKey string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey = r.Header.Get("X-Api-Key")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	withHTTPRequestLookup(t, func(string) (ResolvedHTTPRequest, error) {
		return ResolvedHTTPRequest{BaseURL: srv.URL, AuthType: httprequest.AuthAPIKey, Secret: "k3y"}, nil
	})

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "integration-http",
		Config:     map[string]string{"requestId": "conn-1", "path": "/x", "method": http.MethodGet},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if _, err := ExecuteWorkflow(nodes, nil, nil); err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if gotKey != "k3y" {
		t.Errorf("server received X-Api-Key %q, want %q", gotKey, "k3y")
	}
}

// ADR-0016 Phase B/C: method is an open FieldText field, not a closed
// FieldOptions enum -- proves ResolveNodeDefaults accepts a method
// value outside the old 5-item list (RFC 10008's QUERY) and that it
// actually reaches the server unmodified, through the real
// ExecuteWorkflow path, not just httpconnector's own lower-level test.
func TestExecuteWorkflow_IntegrationHTTP_QueryMethod_Accepted(t *testing.T) {
	var gotMethod string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	withHTTPRequestLookup(t, func(string) (ResolvedHTTPRequest, error) {
		return ResolvedHTTPRequest{BaseURL: srv.URL, AuthType: httprequest.AuthNone}, nil
	})

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "integration-http",
		Config:     map[string]string{"requestId": "conn-1", "path": "/x", "method": "QUERY", "bodyTemplate": `{"filter":"active"}`},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults rejected method %q, want it accepted (open FieldText, ADR-0016): %v", "QUERY", err)
	}
	if _, err := ExecuteWorkflow(nodes, nil, nil); err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if gotMethod != "QUERY" {
		t.Errorf("server received method %q, want QUERY", gotMethod)
	}
}

func TestExecuteWorkflow_IntegrationHTTP_UnknownHTTPRequest_Rejected(t *testing.T) {
	withHTTPRequestLookup(t, func(id string) (ResolvedHTTPRequest, error) {
		return ResolvedHTTPRequest{}, errors.New("no such request")
	})

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "integration-http",
		Config:     map[string]string{"requestId": "does-not-exist", "path": "/x", "method": http.MethodGet},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if _, err := ExecuteWorkflow(nodes, nil, nil); err == nil {
		t.Fatal("ExecuteWorkflow with an unresolvable request returned nil error, want an error")
	}
}

// Real bug this covers: a 4xx/5xx response used to flow through as a
// *successful* node execution (only a transport-level error was
// treated as a failure) -- an error body silently became the workflow's
// payload as if it were good data. Verified via a real httptest.Server
// returning a real 4xx, not a hand-built Response{} fixture. Deliberately
// 400, not 500: go-retryablehttp's DefaultRetryPolicy retries 5xx (with
// backoff), which would make this test slow and conflate "does the
// status check work" with "does the retry policy work" -- that
// library's own retry behavior is already verified directly against its
// source (httpconnector.go's own comment), not something to re-test
// here.
func TestExecuteWorkflow_IntegrationHTTP_NonOKStatus_Rejected(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"boom"}`))
	}))
	defer srv.Close()

	withHTTPRequestLookup(t, func(string) (ResolvedHTTPRequest, error) {
		return ResolvedHTTPRequest{BaseURL: srv.URL, AuthType: httprequest.AuthNone}, nil
	})

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "integration-http",
		Config:     map[string]string{"requestId": "conn-1", "path": "/x", "method": http.MethodGet},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if _, err := ExecuteWorkflow(nodes, nil, nil); err == nil {
		t.Fatal("ExecuteWorkflow with a 500 response returned nil error, want an error")
	}
}

// --- list-lookup: nodeExec resolves a list via the injected
// lookupListFn seam, looks up ctx.Attributes[inputKey], and writes the
// matched entry into ctx.Attributes[outputKey]. ---

func withListLookup(t *testing.T, fn func(id string) (ResolvedList, error)) {
	t.Helper()
	orig := lookupListFn
	lookupListFn = fn
	t.Cleanup(func() { lookupListFn = orig })
}

func TestListLookupExec_MatchWritesOutputAttribute(t *testing.T) {
	withListLookup(t, func(id string) (ResolvedList, error) {
		if id != "list-1" {
			t.Errorf("lookupListFn called with id %q, want %q", id, "list-1")
		}
		return ResolvedList{Entries: map[string]string{"US": "United States"}}, nil
	})

	node := Node{
		NodeTypeID: "list-lookup",
		Config:     map[string]string{"listId": "list-1", "inputKey": "code", "outputKey": "name"},
	}
	out, err := nodeTypeRegistry["list-lookup"].exec(node, ExecContext{Attributes: map[string]any{"code": "US"}})
	if err != nil {
		t.Fatalf("list-lookup exec returned error: %v", err)
	}
	if out.Attributes["name"] != "United States" {
		t.Errorf(`Attributes["name"] = %v, want %q`, out.Attributes["name"], "United States")
	}
}

func TestListLookupExec_NoMatch_Rejected(t *testing.T) {
	withListLookup(t, func(string) (ResolvedList, error) {
		return ResolvedList{Entries: map[string]string{"US": "United States"}}, nil
	})

	node := Node{
		NodeTypeID: "list-lookup",
		Config:     map[string]string{"listId": "list-1", "inputKey": "code", "outputKey": "name"},
	}
	if _, err := nodeTypeRegistry["list-lookup"].exec(node, ExecContext{Attributes: map[string]any{"code": "ZZ"}}); err == nil {
		t.Fatal("list-lookup exec with no matching entry returned nil error, want an error")
	}
}

func TestExecuteWorkflow_ListLookup_UnknownList_Rejected(t *testing.T) {
	withListLookup(t, func(id string) (ResolvedList, error) {
		return ResolvedList{}, errors.New("no such list")
	})

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "list-lookup",
		Config:     map[string]string{"listId": "does-not-exist", "inputKey": "code", "outputKey": "name"},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if _, err := ExecuteWorkflow(nodes, nil, nil); err == nil {
		t.Fatal("ExecuteWorkflow with an unresolvable list returned nil error, want an error")
	}
}

func TestExecuteWorkflow_ListLookup_EndToEnd(t *testing.T) {
	// Exercises the real ExecuteWorkflow path (attributesEnv seeding +
	// nodeExec dispatch), not just the exec function directly -- "code"
	// is a FieldText Attribute, seeded to its zero value ("") by
	// attributesEnv, matched here against a list entry keyed "".
	withListLookup(t, func(string) (ResolvedList, error) {
		return ResolvedList{Entries: map[string]string{"": "Worldwide"}}, nil
	})

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "list-lookup",
		Config:     map[string]string{"listId": "list-1", "inputKey": "code", "outputKey": "name"},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	attrs := []AttributeDef{{Key: "code", Label: "Code", Type: FieldText}}
	if _, err := ExecuteWorkflow(nodes, nil, attrs); err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
}

// --- mcp-tool-call: nodeExec resolves an MCP server via the injected
// lookupMCPServerFn seam, then calls mcpclient.CallTool. The successful-
// call path is real-protocol tested at internal/adapters/mcpclient's own
// level (in-memory transport, no subprocess) -- these tests cover
// composition's own responsibility: resolving the server and parsing
// argumentsJSON, both fully exercisable without ever reaching a real MCP
// server, same as httpconnector's own tests not needing to re-prove
// net/http works. ---

func withMCPServerLookup(t *testing.T, fn func(id string) (ResolvedMCPServer, error)) {
	t.Helper()
	orig := lookupMCPServerFn
	lookupMCPServerFn = fn
	t.Cleanup(func() { lookupMCPServerFn = orig })
}

func TestExecuteWorkflow_MCPToolCall_UnknownServer_Rejected(t *testing.T) {
	withMCPServerLookup(t, func(id string) (ResolvedMCPServer, error) {
		return ResolvedMCPServer{}, errors.New("no such server")
	})

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "mcp-tool-call",
		Config:     map[string]string{"mcpServerId": "does-not-exist", "toolName": "greet"},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if _, err := ExecuteWorkflow(nodes, nil, nil); err == nil {
		t.Fatal("ExecuteWorkflow with an unresolvable MCP server returned nil error, want an error")
	}
}

func TestExecuteWorkflow_MCPToolCall_InvalidArgumentsJSON_Rejected(t *testing.T) {
	withMCPServerLookup(t, func(string) (ResolvedMCPServer, error) {
		return ResolvedMCPServer{Command: "does-not-matter"}, nil
	})

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "mcp-tool-call",
		Config:     map[string]string{"mcpServerId": "server-1", "toolName": "greet", "argumentsJSON": "{not valid json"},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	// Rejected before mcpclient.CallTool is ever reached -- json.Unmarshal
	// fails first, so no real MCP server needs to exist for this case.
	if _, err := ExecuteWorkflow(nodes, nil, nil); err == nil {
		t.Fatal("ExecuteWorkflow with invalid argumentsJSON returned nil error, want an error")
	}
}

// ADR-0016 Phase B (entity half): when the node's own method config is
// blank, the request's own Method is used; when both are blank, GET.
// The node's explicit method still wins -- covers nodes saved before
// HTTPRequest.Method existed (their persisted "GET" default keeps
// behaving identically).
func TestExecuteWorkflow_IntegrationHTTP_MethodFallsBackToRequests(t *testing.T) {
	cases := []struct {
		name          string
		nodeMethod    string
		requestMethod string
		want          string
	}{
		{"node blank, request POST", "", "POST", "POST"},
		{"node explicit override wins", "DELETE", "POST", "DELETE"},
		{"both blank defaults to GET", "", "", "GET"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var gotMethod string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotMethod = r.Method
				w.WriteHeader(http.StatusOK)
			}))
			defer srv.Close()

			withHTTPRequestLookup(t, func(string) (ResolvedHTTPRequest, error) {
				return ResolvedHTTPRequest{BaseURL: srv.URL, Method: tc.requestMethod, AuthType: httprequest.AuthNone}, nil
			})

			nodes, err := ResolveNodeDefaults([]Node{{
				NodeTypeID: "integration-http",
				Config:     map[string]string{"requestId": "conn-1", "path": "/x", "method": tc.nodeMethod},
			}})
			if err != nil {
				t.Fatalf("ResolveNodeDefaults returned error: %v", err)
			}
			if _, err := ExecuteWorkflow(nodes, nil, nil); err != nil {
				t.Fatalf("ExecuteWorkflow returned error: %v", err)
			}
			if gotMethod != tc.want {
				t.Errorf("server received method %q, want %q", gotMethod, tc.want)
			}
		})
	}
}

// The workflow node no longer authors transport/body -- with only a
// requestId configured, method comes from the request's own Method,
// the endpoint path from its single declared operation, and the body
// from its own Body field (direct user decision: "form fields that
// should not be done at the workflow level").
func TestExecuteWorkflow_IntegrationHTTP_TransportComesFromTheRequest(t *testing.T) {
	var gotMethod, gotPath, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath = r.Method, r.URL.Path
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	const spec = `{"openapi":"3.0.3","info":{"title":"t","version":"1"},"paths":{"/widgets":{"post":{"responses":{"200":{"description":"OK"}}}}}}`
	withHTTPRequestLookup(t, func(string) (ResolvedHTTPRequest, error) {
		return ResolvedHTTPRequest{
			BaseURL: srv.URL, Method: "POST", Body: `{"fixed":true}`,
			AuthType: httprequest.AuthNone, OpenAPISpec: spec,
		}, nil
	})

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "integration-http",
		Config:     map[string]string{"requestId": "req-1"},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}
	if _, err := ExecuteWorkflow(nodes, nil, nil); err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	if gotMethod != "POST" || gotPath != "/widgets" || gotBody != `{"fixed":true}` {
		t.Errorf("server received method=%q path=%q body=%q, want POST /widgets with the request's own Body", gotMethod, gotPath, gotBody)
	}
}
