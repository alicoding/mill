package mcpsvc

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/contract"
	"github.com/alicoding/mill/internal/domain/composition"
)

// TestFilterNodeTypesByKind_NoFilterReturnsFullCatalog pins today's
// behavior unchanged: an absent/empty kind is still the full catalog,
// same slice composition.NodeTypes() itself returns.
func TestFilterNodeTypesByKind_NoFilterReturnsFullCatalog(t *testing.T) {
	all := composition.NodeTypes()
	got, err := filterNodeTypesByKind(all, "")
	if err != nil {
		t.Fatalf("filterNodeTypesByKind(\"\"): %v", err)
	}
	if len(got) != len(all) {
		t.Fatalf("got %d node types, want the full catalog's %d", len(got), len(all))
	}
}

// TestFilterNodeTypesByKind_EachValidKind proves every legal kind
// value narrows the catalog to only node types of that kind, and that
// the catalog has at least one entry for each -- a filter that quietly
// returns nothing for a real kind would be as broken as one that errors.
func TestFilterNodeTypesByKind_EachValidKind(t *testing.T) {
	all := composition.NodeTypes()
	for _, k := range filterableNodeKinds {
		k := k
		t.Run(string(k), func(t *testing.T) {
			got, err := filterNodeTypesByKind(all, string(k))
			if err != nil {
				t.Fatalf("filterNodeTypesByKind(%q): %v", k, err)
			}
			if len(got) == 0 {
				t.Fatalf("filterNodeTypesByKind(%q) returned no node types", k)
			}
			for _, nt := range got {
				if nt.Kind != k {
					t.Errorf("filterNodeTypesByKind(%q) included node type %q of kind %q", k, nt.ID, nt.Kind)
				}
			}
		})
	}
}

// TestFilterNodeTypesByKind_InvalidKindNamesLegalValues proves an
// unrecognized kind (including the real-but-unfilterable "terminal")
// errors naming every value that IS legal, rather than silently
// returning an empty or full catalog.
func TestFilterNodeTypesByKind_InvalidKindNamesLegalValues(t *testing.T) {
	for _, bad := range []string{"bogus", "Trigger", "terminal"} {
		_, err := filterNodeTypesByKind(composition.NodeTypes(), bad)
		if err == nil {
			t.Fatalf("filterNodeTypesByKind(%q): want an error, got nil", bad)
		}
		for _, k := range filterableNodeKinds {
			if !strings.Contains(err.Error(), string(k)) {
				t.Errorf("error %q for kind %q missing legal value %q", err, bad, k)
			}
		}
	}
}

// TestMCPListNodeTypes_KindFilter is the MCP-transport-seam coverage
// goal 0052 item 6 asks for: a real client, over real HTTP, exercising
// no filter (full catalog), each valid kind, and an invalid kind's
// error -- the same harness every other authoring proof in this
// package uses.
func TestMCPListNodeTypes_KindFilter(t *testing.T) {
	_, _, session := newIdentifierKindHarness(t, "127.0.0.1:18100")

	full := toolText(t, callTool(t, session, "list_node_types", nil))
	var fullCatalog []composition.NodeType
	if err := json.Unmarshal([]byte(full), &fullCatalog); err != nil {
		t.Fatalf("list_node_types() result not JSON: %v", err)
	}
	if len(fullCatalog) == 0 {
		t.Fatal("list_node_types() with no filter returned an empty catalog")
	}

	for _, k := range filterableNodeKinds {
		raw := toolText(t, callTool(t, session, "list_node_types", map[string]any{"kind": string(k)}))
		var got []composition.NodeType
		if err := json.Unmarshal([]byte(raw), &got); err != nil {
			t.Fatalf("list_node_types(kind=%q) result not JSON: %v", k, err)
		}
		if len(got) == 0 {
			t.Fatalf("list_node_types(kind=%q) returned no node types", k)
		}
		for _, nt := range got {
			if nt.Kind != k {
				t.Errorf("list_node_types(kind=%q) included node type %q of kind %q", k, nt.ID, nt.Kind)
			}
		}
		if len(got) >= len(fullCatalog) {
			t.Errorf("list_node_types(kind=%q) returned %d entries, not narrower than the full catalog's %d", k, len(got), len(fullCatalog))
		}
	}

	res := callTool(t, session, "list_node_types", map[string]any{"kind": "bogus"})
	if !res.IsError {
		t.Fatal("list_node_types(kind=\"bogus\") succeeded, want an error naming the legal kinds")
	}
}

// TestContractDocumentNodeCatalog_MatchesListNodeTypesTool is goal
// 0052 item 6's anti-drift requirement: the root contract document's
// node catalog and list_node_types' unfiltered output must be produced
// by the exact same composition.NodeTypes() call, never two
// independent serializers that could quietly diverge.
func TestContractDocumentNodeCatalog_MatchesListNodeTypesTool(t *testing.T) {
	_, _, session := newIdentifierKindHarness(t, "127.0.0.1:18101")

	toolRaw := toolText(t, callTool(t, session, "list_node_types", nil))
	var fromTool []composition.NodeType
	if err := json.Unmarshal([]byte(toolRaw), &fromTool); err != nil {
		t.Fatalf("list_node_types() result not JSON: %v", err)
	}

	docBytes, err := contract.GenerateDocument()
	if err != nil {
		t.Fatalf("contract.GenerateDocument: %v", err)
	}
	var doc struct {
		NodeTypes []composition.NodeType `json:"nodeTypes"`
	}
	if err := json.Unmarshal(docBytes, &doc); err != nil {
		t.Fatalf("decode generated document: %v", err)
	}

	toolJSON, err := json.Marshal(fromTool)
	if err != nil {
		t.Fatalf("marshal tool catalog: %v", err)
	}
	docJSON, err := json.Marshal(doc.NodeTypes)
	if err != nil {
		t.Fatalf("marshal document catalog: %v", err)
	}
	if string(toolJSON) != string(docJSON) {
		t.Errorf("contract document's node catalog diverges from list_node_types' own output:\ndocument: %s\ntool: %s", docJSON, toolJSON)
	}
}

// TestMCPListStepTypes_KindFilter mirrors TestMCPListNodeTypes_KindFilter
// against list_step_types (docs/goals/0053 tier 2's primary tool name) --
// both tools share one handler, but this proves the primary name works
// standalone, not just as a byte-identical alias of the deprecated one.
func TestMCPListStepTypes_KindFilter(t *testing.T) {
	_, _, session := newIdentifierKindHarness(t, "127.0.0.1:18104")

	full := toolText(t, callTool(t, session, "list_step_types", nil))
	var fullCatalog []composition.NodeType
	if err := json.Unmarshal([]byte(full), &fullCatalog); err != nil {
		t.Fatalf("list_step_types() result not JSON: %v", err)
	}
	if len(fullCatalog) == 0 {
		t.Fatal("list_step_types() with no filter returned an empty catalog")
	}

	for _, k := range filterableNodeKinds {
		raw := toolText(t, callTool(t, session, "list_step_types", map[string]any{"kind": string(k)}))
		var got []composition.NodeType
		if err := json.Unmarshal([]byte(raw), &got); err != nil {
			t.Fatalf("list_step_types(kind=%q) result not JSON: %v", k, err)
		}
		if len(got) == 0 {
			t.Fatalf("list_step_types(kind=%q) returned no step types", k)
		}
		for _, nt := range got {
			if nt.Kind != k {
				t.Errorf("list_step_types(kind=%q) included step type %q of kind %q", k, nt.ID, nt.Kind)
			}
		}
	}

	res := callTool(t, session, "list_step_types", map[string]any{"kind": "bogus"})
	if !res.IsError {
		t.Fatal("list_step_types(kind=\"bogus\") succeeded, want an error naming the legal kinds")
	}
}

// TestMCPListNodeTypes_IsDeprecatedAliasOfListStepTypes pins the
// backward-compatibility promise (docs/goals/0053 tier 2): an existing
// caller still using list_node_types gets the byte-identical catalog
// list_step_types returns, unfiltered and with a kind filter applied.
func TestMCPListNodeTypes_IsDeprecatedAliasOfListStepTypes(t *testing.T) {
	_, _, session := newIdentifierKindHarness(t, "127.0.0.1:18105")

	stepTypesFull := toolText(t, callTool(t, session, "list_step_types", nil))
	nodeTypesFull := toolText(t, callTool(t, session, "list_node_types", nil))
	if stepTypesFull != nodeTypesFull {
		t.Errorf("list_node_types() diverges from list_step_types():\nlist_step_types: %s\nlist_node_types: %s", stepTypesFull, nodeTypesFull)
	}

	stepTypesFiltered := toolText(t, callTool(t, session, "list_step_types", map[string]any{"kind": "process"}))
	nodeTypesFiltered := toolText(t, callTool(t, session, "list_node_types", map[string]any{"kind": "process"}))
	if stepTypesFiltered != nodeTypesFiltered {
		t.Errorf("list_node_types(kind=process) diverges from list_step_types(kind=process):\nlist_step_types: %s\nlist_node_types: %s", stepTypesFiltered, nodeTypesFiltered)
	}
}
