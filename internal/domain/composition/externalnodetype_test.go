package composition

import (
	"strings"
	"testing"
)

// An external node type resolves everywhere a registered one does --
// the catalog, the by-id lookup, the executor -- and disappears when
// its provider stops listing it.
func TestExternalNodeType_ResolvesAndExecutes(t *testing.T) {
	ext := ExternalNodeType{
		NodeType: NodeType{ID: "process-ext-shout", Kind: KindProcess, Label: "Shout", Description: "Upper-cases.", Consumes: []PayloadKind{PayloadText}, Produces: PayloadProduce{Kind: PayloadText}, Complexity: ComplexityBasic, PaletteGroup: "transform"},
		Exec: func(_ Node, ctx ExecContext) (ExecContext, error) {
			ctx.Payload = strings.ToUpper(ctx.Payload)
			return ctx, nil
		},
	}
	SetExternalNodeTypeLookup(func() []ExternalNodeType { return []ExternalNodeType{ext} })
	t.Cleanup(func() { SetExternalNodeTypeLookup(nil) })

	if nt, ok := LookupNodeType("process-ext-shout"); !ok || nt.Label != "Shout" {
		t.Fatalf("LookupNodeType = %+v ok=%v", nt, ok)
	}
	found := false
	for _, nt := range NodeTypes() {
		found = found || nt.ID == "process-ext-shout"
	}
	if !found {
		t.Fatal("NodeTypes() omits the external type")
	}
	out, err := ExecuteNodeAlone(Node{ID: "n", NodeTypeID: "process-ext-shout", Kind: KindProcess}, nil, ExecContext{Payload: "hi"})
	if err != nil || out.Payload != "HI" {
		t.Fatalf("exec = %+v err=%v", out, err)
	}
	nodes := []Node{{ID: "t", NodeTypeID: "trigger-manual", Kind: KindTrigger}, {ID: "s", NodeTypeID: "process-ext-shout", Kind: KindProcess}}
	edges := []Edge{{ID: "e", Source: "t", Target: "s"}}
	result, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{InitialPayload: "abc"})
	if err != nil || result != "ABC" {
		t.Fatalf("ExecuteWorkflow = %q err=%v", result, err)
	}

	SetExternalNodeTypeLookup(nil)
	if _, ok := LookupNodeType("process-ext-shout"); ok {
		t.Fatal("the external type outlived its provider")
	}
}
