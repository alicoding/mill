package composition

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/connector"
)

// chain builds a linear node/edge graph from an ordered list of node
// type IDs, giving each node a predictable ID (its type ID) so tests can
// reference them -- real callers (the canvas) generate random IDs, but
// tests want stable, readable ones.
func chain(nodeTypeIDs ...string) ([]Node, []Edge) {
	nodes := make([]Node, len(nodeTypeIDs))
	for i, id := range nodeTypeIDs {
		nodes[i] = Node{ID: id, NodeTypeID: id}
	}
	edges := make([]Edge, 0, len(nodeTypeIDs)-1)
	for i := 0; i < len(nodeTypeIDs)-1; i++ {
		edges = append(edges, Edge{ID: nodeTypeIDs[i] + "-" + nodeTypeIDs[i+1], Source: nodeTypeIDs[i], Target: nodeTypeIDs[i+1]})
	}
	return nodes, edges
}

func TestExecuteWorkflow_UnknownNodeType(t *testing.T) {
	nodes, edges := chain("does-not-exist")
	if _, err := ExecuteWorkflow(nodes, edges, nil); err == nil {
		t.Fatal("ExecuteWorkflow(unknown node type) returned nil error, want an error")
	}
}

func TestExecuteWorkflow_LoadSampleHTML_UsesDefault(t *testing.T) {
	var written string
	withFakeClipboard(t, nil, func(html string) error {
		written = html
		return nil
	}, nil)

	nodes, err := ResolveNodeDefaults([]Node{{NodeTypeID: "apply-clipboard-write-html"}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	result, err := ExecuteWorkflow(nodes, nil, nil)
	if err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if written != sampleHTML {
		t.Errorf("apply-clipboard-write-html was called with %q, want the sample HTML", written)
	}
	if !strings.Contains(result, "Quarterly update") {
		t.Errorf("ExecuteWorkflow result = %q, want it to contain the sample HTML", result)
	}
}

func TestExecuteWorkflow_LoadSampleHTML_UsesConfiguredValue(t *testing.T) {
	var written string
	withFakeClipboard(t, nil, func(html string) error {
		written = html
		return nil
	}, nil)

	nodes, err := ResolveNodeDefaults([]Node{
		{NodeTypeID: "apply-clipboard-write-html", Config: map[string]string{"html": "<p>custom configured value</p>"}},
	})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	result, err := ExecuteWorkflow(nodes, nil, nil)
	if err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if written != "<p>custom configured value</p>" {
		t.Errorf("apply-clipboard-write-html was called with %q, want the configured (non-default) value", written)
	}
	if !strings.Contains(result, "custom configured value") {
		t.Errorf("ExecuteWorkflow result = %q, want the configured value", result)
	}
}

func TestExecuteWorkflow_ClipboardHTMLToMarkdown(t *testing.T) {
	var written string
	withFakeClipboard(t, func() (string, error) {
		return "<h2>Hi</h2><p>the <strong>bit</strong></p>", nil
	}, nil, func(md string) error {
		written = md
		return nil
	})

	nodes, edges := chain("capture-clipboard-html", "process-html-to-markdown", "apply-clipboard-write-text")
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	result, err := ExecuteWorkflow(resolved, edges, nil)
	if err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if !strings.Contains(result, "## Hi") || !strings.Contains(result, "**bit**") {
		t.Errorf("ExecuteWorkflow result = %q, want converted markdown", result)
	}
	if written != result {
		t.Errorf("apply-clipboard-write-text was called with %q, want it to match the returned markdown %q", written, result)
	}
}

func TestExecuteWorkflow_ClipboardHTMLToMarkdown_NoHTMLOnClipboard(t *testing.T) {
	withFakeClipboard(t, func() (string, error) {
		return "", errors.New("no HTML on clipboard")
	}, nil, nil)

	nodes, edges := chain("capture-clipboard-html", "process-html-to-markdown", "apply-clipboard-write-text")
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	// Unlike internal/domain/runbook's soft-failure path (nil error,
	// friendly explanation), this prototype's executor surfaces a plain
	// error -- documented as a deliberate simplification in
	// ExecuteWorkflow's doc comment, confirmed here so it isn't mistaken
	// for a bug later.
	if _, err := ExecuteWorkflow(resolved, edges, nil); err == nil {
		t.Fatal("ExecuteWorkflow with no clipboard HTML returned nil error, want an error (plain-error prototype behavior, unlike runbook's soft-failure)")
	}
}

// --- integration-http: nodeExec resolves a connector via the injected
// lookupConnectorFn seam and executes a real HTTP call through
// httpconnector against an httptest.Server. ---

func withConnectorLookup(t *testing.T, fn func(id string) (ResolvedConnector, error)) {
	t.Helper()
	orig := lookupConnectorFn
	lookupConnectorFn = fn
	t.Cleanup(func() { lookupConnectorFn = orig })
}

func TestExecuteWorkflow_IntegrationHTTP_UsesConnectorAndPath(t *testing.T) {
	var gotPath, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	withConnectorLookup(t, func(id string) (ResolvedConnector, error) {
		if id != "conn-1" {
			t.Errorf("lookupConnectorFn called with id %q, want %q", id, "conn-1")
		}
		return ResolvedConnector{BaseURL: srv.URL, AuthType: connector.AuthBearer, Secret: "tok"}, nil
	})

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "integration-http",
		Config:     map[string]string{"connectorId": "conn-1", "path": "/v1/things", "method": http.MethodGet},
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

	withConnectorLookup(t, func(string) (ResolvedConnector, error) {
		return ResolvedConnector{BaseURL: srv.URL, AuthType: connector.AuthAPIKey, Secret: "k3y"}, nil
	})

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "integration-http",
		Config:     map[string]string{"connectorId": "conn-1", "path": "/x", "method": http.MethodGet},
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

func TestExecuteWorkflow_IntegrationHTTP_UnknownConnector_Rejected(t *testing.T) {
	withConnectorLookup(t, func(id string) (ResolvedConnector, error) {
		return ResolvedConnector{}, errors.New("no such connector")
	})

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "integration-http",
		Config:     map[string]string{"connectorId": "does-not-exist", "path": "/x", "method": http.MethodGet},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if _, err := ExecuteWorkflow(nodes, nil, nil); err == nil {
		t.Fatal("ExecuteWorkflow with an unresolvable connector returned nil error, want an error")
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

	withConnectorLookup(t, func(string) (ResolvedConnector, error) {
		return ResolvedConnector{BaseURL: srv.URL, AuthType: connector.AuthNone}, nil
	})

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "integration-http",
		Config:     map[string]string{"connectorId": "conn-1", "path": "/x", "method": http.MethodGet},
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
