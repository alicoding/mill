package composition

import (
	"testing"
)

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
		for _, f := range nt.ConfigFields {
			if f.Key == "" || f.Label == "" {
				t.Errorf("node type %q has a config field with an empty Key/Label: %+v", nt.ID, f)
			}
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
