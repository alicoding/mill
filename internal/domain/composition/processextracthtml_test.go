package composition

import (
	"strings"
	"testing"
)

const extractFixtureHTML = `<html><body>
<nav>Site navigation chrome</nav>
<main id="main-content"><h1>Real heading</h1></main>
<footer>Site footer chrome</footer>
</body></html>`

// TestProcessExtractHTML_DefaultSelector_MatchesMainContent proves the
// node's own default (the ConfigField's Default, not just the package
// constant) actually resolves and extracts, through the real
// ExecuteWorkflow node-exec path.
func TestProcessExtractHTML_DefaultSelector_MatchesMainContent(t *testing.T) {
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "p", NodeTypeID: "process-extract-html"},
	})
	if err != nil {
		t.Fatal(err)
	}
	edges := []Edge{{ID: "e", Source: "t", Target: "p"}}

	out, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{InitialPayload: extractFixtureHTML})
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	if !strings.Contains(out, "Real heading") {
		t.Errorf("output = %q, want the extracted main-content subtree", out)
	}
	if strings.Contains(out, "chrome") {
		t.Errorf("output = %q, want the nav/footer chrome dropped", out)
	}
}

// TestProcessExtractHTML_CustomSelector_Overrides proves a
// user-configured selector is actually used instead of the default.
func TestProcessExtractHTML_CustomSelector_Overrides(t *testing.T) {
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "p", NodeTypeID: "process-extract-html", Config: map[string]string{"selector": "nav"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	edges := []Edge{{ID: "e", Source: "t", Target: "p"}}

	out, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{InitialPayload: extractFixtureHTML})
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	if !strings.Contains(out, "Site navigation chrome") {
		t.Errorf("output = %q, want the nav subtree the custom selector targets", out)
	}
}

// TestProcessExtractHTML_NoMatch_FailsTheStep proves the fail-safe
// behavior: no match never silently passes the whole document through.
func TestProcessExtractHTML_NoMatch_FailsTheStep(t *testing.T) {
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "p", NodeTypeID: "process-extract-html", Config: map[string]string{"selector": "#nothing-here"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	edges := []Edge{{ID: "e", Source: "t", Target: "p"}}

	if _, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{InitialPayload: extractFixtureHTML}); err == nil {
		t.Fatal("ExecuteWorkflow() error = nil, want a no-match error, not a silent passthrough")
	}
}
