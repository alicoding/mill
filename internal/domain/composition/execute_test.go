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
