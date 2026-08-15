package composition

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

// withDeclaredNodeTypeLookup mirrors withHTTPRequestLookup (execute_test.go)
// -- installs a fake declared-type provider for one test and restores
// the default (no declared types) via t.Cleanup, so this package's own
// other tests (notably NodeTypes()-driven ones like TestNodeTypes and
// seedproof_test.go's registry checks) never observe leaked state.
func withDeclaredNodeTypeLookup(t *testing.T, bindings ...DeclaredStepBinding) {
	t.Helper()
	SetDeclaredNodeTypeLookup(func() []DeclaredStepBinding { return bindings })
	t.Cleanup(func() { SetDeclaredNodeTypeLookup(nil) })
}

func findNodeType(t *testing.T, id string) NodeType {
	t.Helper()
	for _, nt := range NodeTypes() {
		if nt.ID == id {
			return nt
		}
	}
	t.Fatalf("NodeTypes() has no entry %q", id)
	return NodeType{}
}

// TestDeclaredNodeType_SynthesizedView_SatisfiesNodeStandard applies
// the same invariants TestNodeTypes (nodetypes_test.go) checks for
// every built-in NodeType, to a declared step type's own synthesized
// view (.claude/rules/node-standard.md: "the node-standard checklist
// applies to declared types structurally"). ID/Label/Description
// non-empty, every ConfigField documents itself, Effect is explicit,
// Output is non-empty, and Declared is true -- the one field that
// distinguishes a synthesized entry from a compile-time one.
func TestDeclaredNodeType_SynthesizedView_SatisfiesNodeStandard(t *testing.T) {
	withDeclaredNodeTypeLookup(t, DeclaredStepBinding{
		ID: "declared-check-httpbin", Label: "Check httpbin", Description: "Calls the seeded httpbin integration.",
		EngineNodeTypeID: "integration-http",
		PinnedConfig:     map[string]string{"requestId": "example-none-httpbin"},
		HiddenFields:     []string{"requestId"},
	})

	nt := findNodeType(t, "declared-check-httpbin")

	if nt.ID == "" || nt.Label == "" || nt.Description == "" {
		t.Errorf("synthesized view %+v has an empty ID/Label/Description", nt)
	}
	for _, f := range nt.ConfigFields {
		if f.Key == "" || f.Label == "" || f.Description == "" {
			t.Errorf("synthesized view %q has an undocumented config field: %+v", nt.ID, f)
		}
	}
	if nt.Effect == "" {
		t.Errorf("synthesized view %q has no explicit Effect -- a declared type must inherit one from its engine, never the silently-permissive zero value", nt.ID)
	}
	if nt.Output == "" {
		t.Errorf("synthesized view %q has an empty Output", nt.ID)
	}
	if !nt.Declared {
		t.Errorf("synthesized view %q has Declared=false, want true", nt.ID)
	}
}

// TestDeclaredNodeType_EffectInheritedVerbatim_NeverWeakensGating pins
// ADR-0037's sharpest guarantee: "a declaration can never weaken
// gating" -- a declared step type's Effect must equal its underlying
// engine's Effect exactly, never a downgraded/omitted class.
func TestDeclaredNodeType_EffectInheritedVerbatim_NeverWeakensGating(t *testing.T) {
	withDeclaredNodeTypeLookup(t, DeclaredStepBinding{
		ID: "declared-external-call", Label: "External call", Description: "d",
		EngineNodeTypeID: "integration-http",
		PinnedConfig:     map[string]string{"requestId": "x"},
		HiddenFields:     []string{"requestId"},
	})

	nt := findNodeType(t, "declared-external-call")
	underlying, ok := nodeType("integration-http")
	if !ok {
		t.Fatal(`nodeType("integration-http") not found`)
	}
	if nt.Effect != underlying.Effect {
		t.Errorf("declared type's Effect = %q, want the underlying engine's Effect %q verbatim", nt.Effect, underlying.Effect)
	}
	if nt.Effect != guardrail.ClassExternal {
		t.Errorf("declared type's Effect = %q, want ClassExternal (integration-http's own class)", nt.Effect)
	}
}

// TestDeclaredNodeType_HiddenFieldsRemoved_PinnedFieldsKeptAsDefaults
// proves synthesis's config-merge rule: a hidden field (the engine's
// own binding field) disappears from ConfigFields entirely, while a
// pinned-but-not-hidden field stays visible with the pinned value as
// its new Default.
func TestDeclaredNodeType_HiddenFieldsRemoved_PinnedFieldsKeptAsDefaults(t *testing.T) {
	withDeclaredNodeTypeLookup(t, DeclaredStepBinding{
		ID: "declared-mcp-ping", Label: "Ping", Description: "d",
		EngineNodeTypeID: "mcp-tool-call",
		PinnedConfig:     map[string]string{"mcpServerId": "s1", "toolName": "ping", "argumentsJSON": `{"n":1}`},
		HiddenFields:     []string{"mcpServerId", "toolName"},
	})

	nt := findNodeType(t, "declared-mcp-ping")
	if len(nt.ConfigFields) != 1 {
		t.Fatalf("synthesized ConfigFields = %+v, want exactly 1 (argumentsJSON) with mcpServerId/toolName hidden", nt.ConfigFields)
	}
	f := nt.ConfigFields[0]
	if f.Key != "argumentsJSON" {
		t.Errorf("remaining config field = %q, want argumentsJSON", f.Key)
	}
	if f.Default != `{"n":1}` {
		t.Errorf("argumentsJSON Default = %q, want the pinned value", f.Default)
	}
}

// TestDeclaredNodeType_UnresolvableEngine_SilentlySkipped proves a
// binding naming an engine that isn't a real registered NodeType never
// surfaces a broken catalog entry -- resolveDeclaredEntry's own
// documented ok=false path.
func TestDeclaredNodeType_UnresolvableEngine_SilentlySkipped(t *testing.T) {
	withDeclaredNodeTypeLookup(t, DeclaredStepBinding{ID: "declared-orphan", Label: "Orphan", EngineNodeTypeID: "does-not-exist"})

	for _, nt := range NodeTypes() {
		if nt.ID == "declared-orphan" {
			t.Fatal("NodeTypes() includes a declared type whose engine doesn't exist -- want it silently skipped")
		}
	}
	if _, ok := nodeType("declared-orphan"); ok {
		t.Error(`nodeType("declared-orphan") = ok, want not found`)
	}
}

// TestDeclaredNodeType_Exec_DelegatesToEngineWithPinnedConfigWinning
// proves ExecuteWorkflow running a declared-type node genuinely
// delegates to the underlying engine's real exec (a real HTTP round
// trip against an httptest.Server, same "test against something real,
// minus the network dependency" bar integrationexec_test.go sets), and
// that a pinned config value overrides whatever the authored node's
// own Config carries for the same key -- goal 0054 slice A's own
// "pinned values overriding, node-local values for unpinned fields"
// requirement.
func TestDeclaredNodeType_Exec_DelegatesToEngineWithPinnedConfigWinning(t *testing.T) {
	var gotRequestID string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	withHTTPRequestLookup(t, func(id string) (ResolvedHTTPRequest, error) {
		gotRequestID = id
		return ResolvedHTTPRequest{BaseURL: srv.URL}, nil
	})
	withDeclaredNodeTypeLookup(t, DeclaredStepBinding{
		ID: "declared-check", Label: "Check", Description: "d",
		EngineNodeTypeID: "integration-http",
		PinnedConfig:     map[string]string{"requestId": "pinned-request"},
		HiddenFields:     []string{"requestId"},
	})

	// The authored node still carries a (bogus, would-fail-if-used)
	// requestId of its own -- proving the pinned value wins, not the
	// node-local one, exactly the invariant this test names.
	nodes, err := ResolveNodeDefaults([]Node{{NodeTypeID: "declared-check", Config: map[string]string{"requestId": "should-be-overridden"}}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	result, err := ExecuteWorkflow(nodes, nil, nil)
	if err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if result != `{"ok":true}` {
		t.Errorf("ExecuteWorkflow result = %q, want the fake server's response body", result)
	}
	if gotRequestID != "pinned-request" {
		t.Errorf("lookupHTTPRequestFn received id %q, want the PINNED requestId %q to win over the node-local value", gotRequestID, "pinned-request")
	}
}
