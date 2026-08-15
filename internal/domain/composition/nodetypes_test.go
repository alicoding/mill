package composition

import (
	"strings"
	"testing"
)

// pureNodeTypes is the CLOSED allow-list of NodeType IDs permitted to
// leave Effect at its Go zero value ("") -- docs/goals/0030-node-
// standard.md item (b), the standard's priority machine check. The
// zero value is silently indistinguishable from guardrail.ClassNone at
// run time (NodeTypeEffect, execute.go: `entry.nodeType.Effect == ""`
// resolves to ClassNone), and ClassNone -- like every class except
// ClassExternal -- defaults to ALLOW with no guardrail gate at all
// (guardrail.DefaultEffect). A node type with real I/O left at the zero
// value would silently run ungated; this list exists so that can only
// happen for an ID a human explicitly reviewed and named here, never by
// omission. New node types MUST declare Effect explicitly (ruleset and
// human-review are the house style: `Effect: guardrail.ClassNone`
// written out, not left blank) -- add to this list ONLY for a node
// verified to have no I/O of its own, with the reason recorded inline.
var pureNodeTypes = map[string]string{
	// Trigger kinds and decision-route register with exec: nil
	// (registry.go) -- ExecuteWorkflow's own Kind check skips them
	// structurally before the guardrail gate is ever reached
	// (execute.go), so no Effect class is meaningful for any of them.
	"trigger-manual":           "exec=nil entry point, never reaches the guardrail gate",
	"trigger-hotkey":           "exec=nil entry point, never reaches the guardrail gate",
	"trigger-schedule":         "exec=nil entry point, never reaches the guardrail gate",
	"trigger-clipboard-watch":  "exec=nil entry point, never reaches the guardrail gate",
	"trigger-filesystem-watch": "exec=nil entry point, never reaches the guardrail gate",
	"trigger-callable":         "exec=nil entry point, never reaches the guardrail gate",
	"trigger-system-event":     "exec=nil entry point, never reaches the guardrail gate",
	"trigger-atlas-card":       "exec=nil entry point, never reaches the guardrail gate",
	"decision-route":           "exec=nil, pure routing -- conditions live on its outgoing edges",
	// Genuine no-I/O transforms/reads: operate only on the in-memory
	// ExecContext (Payload/Attributes) already threaded through, no
	// external/local/read effect of any kind.
	"capture-attribute":        "reads ExecContext.Attributes in-memory, no I/O",
	"process-extract-html":     "pure string/DOM transform on the in-memory payload, no I/O",
	"process-inject-text":      "pure string transform on the in-memory payload, no I/O",
	"process-html-to-markdown": "pure string transform on the in-memory payload, no I/O",
}

// kindIDPrefix is the Kind -> required ID-prefix convention item (c)
// enforces (docs/goals/0030-node-standard.md). Every NEW NodeType's ID
// must start with its Kind's prefix; idPrefixExceptions below is the
// CLOSED list of IDs that predate this convention.
var kindIDPrefix = map[NodeKind]string{
	KindTrigger:  "trigger-",
	KindCapture:  "capture-",
	KindProcess:  "process-",
	KindApply:    "apply-",
	KindDecision: "decision-",
	KindTerminal: "terminal-",
}

// idPrefixExceptions is the CLOSED allow-list of pre-pattern IDs that
// don't follow kindIDPrefix -- every one of them shipped before this
// standard existed. This list must never grow; a new node type's ID
// has to follow its Kind's prefix.
var idPrefixExceptions = map[string]bool{
	"child-workflow":   true, // KindProcess
	"code-execution":   true, // KindProcess
	"human-review":     true, // KindProcess
	"ruleset":          true, // KindProcess
	"integration-http": true, // KindProcess
	"list-lookup":      true, // KindProcess
	"list-search":      true, // KindProcess
	"mcp-tool-call":    true, // KindProcess
	"decision-outcome": true, // KindTerminal, named for its pre-ADR-0027 "Decision" identity
}

// TestNodeTypes is the Mill Node Standard's machine-checkable subset
// (docs/goals/0030-node-standard.md, .claude/rules/node-standard.md):
// every registered NodeType is reviewed against these checks, not just
// spot-checked by eye.
func TestNodeTypes(t *testing.T) {
	types := NodeTypes()
	if len(types) == 0 {
		t.Fatal("NodeTypes() returned no node types")
	}
	seen := make(map[string]bool)
	for _, nt := range types {
		if nt.ID == "" || nt.Label == "" || nt.Description == "" {
			t.Errorf("node type %+v has an empty ID/Label/Description", nt)
		}
		if seen[nt.ID] {
			t.Errorf("duplicate node type ID %q", nt.ID)
		}
		seen[nt.ID] = true

		// (a) Every ConfigField carries a Description -- the standard's
		// "typed fields document themselves" requirement; an
		// undocumented field forces guessing at authoring time.
		for _, f := range nt.ConfigFields {
			if f.Key == "" || f.Label == "" {
				t.Errorf("node type %q has a config field with an empty Key/Label: %+v", nt.ID, f)
			}
			if f.Description == "" {
				t.Errorf("node type %q config field %q has an empty Description (standard item a)", nt.ID, f.Key)
			}
		}

		// (b) Effect must be explicit, not the silently-permissive zero
		// value -- see pureNodeTypes' own doc comment for the danger.
		if nt.Effect == "" {
			if _, ok := pureNodeTypes[nt.ID]; !ok {
				t.Errorf("node type %q has no explicit Effect class (standard item b): "+
					"the zero value silently resolves to ClassNone/allow-with-no-guardrail-gate "+
					"(NodeTypeEffect, execute.go) -- either declare Effect explicitly in its "+
					"RegisterNodeType call, or add its ID to pureNodeTypes in nodetypes_test.go "+
					"with a reason, if it genuinely performs no I/O", nt.ID)
			}
		}

		// (c) ID is prefixed by its Kind's naming convention, unless
		// it's a named pre-pattern exception.
		if prefix, ok := kindIDPrefix[nt.Kind]; ok && !strings.HasPrefix(nt.ID, prefix) {
			if !idPrefixExceptions[nt.ID] {
				t.Errorf("node type %q (Kind %q) doesn't start with the Kind's %q prefix (standard item c) "+
					"and isn't in idPrefixExceptions", nt.ID, nt.Kind, prefix)
			}
		}

		// (d) Output is non-empty for every NodeType -- required
		// universally (every currently-registered NodeType, including
		// every terminal/apply kind, already declares one; no kind gets
		// a free pass).
		if nt.Output == "" {
			t.Errorf("node type %q has an empty Output (standard item d): "+
				"name what payload/Attributes state leaves this step, even if it's "+
				"\"payload unchanged\" (see ruleset/decision-route)", nt.ID)
		}

		// (e) Complexity is one of the two declared values, for every
		// NodeType, no exceptions -- docs/goals/0047-node-audience-facet.md.
		// Unlike Effect (item b), there is no allow-list of legitimate
		// omissions: every node type, however simple, has a real
		// classification.
		if !ValidComplexity(nt.Complexity) {
			t.Errorf("node type %q has an invalid Complexity %q (standard item e): "+
				"declare Complexity: ComplexityBasic or ComplexityAdvanced explicitly "+
				"in its RegisterNodeType call", nt.ID, nt.Complexity)
		}
	}
}

// TestValidComplexity exercises ValidComplexity directly against every
// legitimate value plus the invalid ones TestNodeTypes' item (e) check
// relies on it to catch -- the zero value (a NodeType that omitted
// Complexity entirely) and an arbitrary unrecognized string.
func TestValidComplexity(t *testing.T) {
	cases := []struct {
		c    Complexity
		want bool
	}{
		{ComplexityBasic, true},
		{ComplexityAdvanced, true},
		{"", false},
		{"intermediate", false},
	}
	for _, tc := range cases {
		if got := ValidComplexity(tc.c); got != tc.want {
			t.Errorf("ValidComplexity(%q) = %v, want %v", tc.c, got, tc.want)
		}
	}
}

func TestBuiltInWorkflows_AllNodesFullyResolvedAndExecutable(t *testing.T) {
	for _, wf := range BuiltInWorkflows() {
		if !wf.BuiltIn {
			t.Errorf("workflow %q from BuiltInWorkflows() has BuiltIn=false", wf.ID)
		}
		if len(wf.Nodes) == 0 {
			t.Errorf("workflow %q has no nodes", wf.ID)
		}
		for _, node := range wf.Nodes {
			nt, ok := nodeType(node.NodeTypeID)
			if !ok {
				t.Errorf("workflow %q references unknown node type %q", wf.ID, node.NodeTypeID)
				continue
			}
			if node.Kind != nt.Kind {
				t.Errorf("workflow %q node %q has Kind %q, want %q (derived from node type)", wf.ID, node.NodeTypeID, node.Kind, nt.Kind)
			}
			for _, field := range nt.ConfigFields {
				if _, ok := node.Config[field.Key]; !ok {
					t.Errorf("workflow %q node %q missing resolved config key %q", wf.ID, node.NodeTypeID, field.Key)
				}
			}
		}
		// Every built-in workflow must itself form a valid graph --
		// exercising ValidateGraph against real seeded data, not just
		// hand-built test fixtures.
		if err := ValidateGraphStrict(wf.Nodes, wf.Edges, wf.Attributes); err != nil {
			t.Errorf("workflow %q nodes/edges don't form a valid graph: %v", wf.ID, err)
		}
	}
}

func TestResolveNodeDefaults_FillsMissingKeysWithDefaults(t *testing.T) {
	resolved, err := ResolveNodeDefaults([]Node{{NodeTypeID: "apply-clipboard-write-html"}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if resolved[0].Config["html"] != sampleHTML {
		t.Errorf("resolved config[html] = %q, want the field's default", resolved[0].Config["html"])
	}
}

func TestResolveNodeDefaults_PreservesExplicitValue(t *testing.T) {
	resolved, err := ResolveNodeDefaults([]Node{
		{NodeTypeID: "apply-clipboard-write-html", Config: map[string]string{"html": "<p>custom</p>"}},
	})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if resolved[0].Config["html"] != "<p>custom</p>" {
		t.Errorf("resolved config[html] = %q, want the explicit value preserved, not overwritten by the default", resolved[0].Config["html"])
	}
}

func TestResolveNodeDefaults_UnknownNodeType(t *testing.T) {
	if _, err := ResolveNodeDefaults([]Node{{NodeTypeID: "does-not-exist"}}); err == nil {
		t.Fatal("ResolveNodeDefaults(unknown node type) returned nil error, want an error")
	}
}

func TestResolveNodeDefaults_AssignsIDWhenMissing(t *testing.T) {
	resolved, err := ResolveNodeDefaults([]Node{{NodeTypeID: "capture-clipboard-html"}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if resolved[0].ID == "" {
		t.Error("ResolveNodeDefaults left ID empty, want a generated ID")
	}
}

func TestResolveNodeDefaults_PreservesExplicitID(t *testing.T) {
	resolved, err := ResolveNodeDefaults([]Node{{ID: "my-node", NodeTypeID: "capture-clipboard-html"}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if resolved[0].ID != "my-node" {
		t.Errorf("resolved ID = %q, want the explicit ID preserved", resolved[0].ID)
	}
}

func TestResolveNodeDefaults_DerivesKindFromNodeType(t *testing.T) {
	// A client-supplied Kind must never be trusted -- ResolveNodeDefaults
	// always overwrites it from the looked-up node type, so it can't
	// drift out of sync with the node type it names.
	resolved, err := ResolveNodeDefaults([]Node{{NodeTypeID: "capture-clipboard-html", Kind: "bogus"}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if resolved[0].Kind != KindCapture {
		t.Errorf("resolved Kind = %q, want %q derived from the node type, not the client-supplied value", resolved[0].Kind, KindCapture)
	}
}
