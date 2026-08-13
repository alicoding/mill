package composition

import (
	"errors"
	"strings"
	"testing"
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
	// No HTML flavor, but plain text present: SPEC §5's capture
	// fallback (HTML -> plain text) means the workflow succeeds on the
	// text rather than erroring (updated from the old HTML-or-nothing
	// behavior, goal 0001).
	withFakeClipboard(t, func() (string, error) {
		return "", errors.New("no HTML on clipboard")
	}, nil, nil)
	readClipboardText = func() (string, error) { return "plain fallback", nil }

	nodes, edges := chain("capture-clipboard-html", "process-html-to-markdown", "apply-clipboard-write-text")
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	out, err := ExecuteWorkflow(resolved, edges, nil)
	if err != nil {
		t.Fatalf("ExecuteWorkflow fell through both clipboard flavors: %v", err)
	}
	if out != "plain fallback" {
		t.Fatalf("out = %q, want the plain-text fallback flowing through markdown+apply", out)
	}
}

// --- integration-http: nodeExec resolves a request via the injected
// lookupHTTPRequestFn seam and executes a real HTTP call through
// httpconnector against an httptest.Server. ---

func withHTTPRequestLookup(t *testing.T, fn func(id string) (ResolvedHTTPRequest, error)) {
	t.Helper()
	orig := lookupHTTPRequestFn
	lookupHTTPRequestFn = fn
	t.Cleanup(func() { lookupHTTPRequestFn = orig })
}
