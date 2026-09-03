package composition

import (
	"strings"
	"testing"
)

// The step-test door runs exactly the registered exec: the converter
// step's own output, on a bare input, with the attribute defaults seeded.
func TestExecuteNodeAlone_RunsTheRegisteredExec(t *testing.T) {
	node := Node{ID: "n1", NodeTypeID: "process-html-to-markdown", Kind: KindProcess}
	out, err := ExecuteNodeAlone(node, []AttributeDef{{Key: "count", Type: FieldNumber}}, ExecContext{Payload: "<h1>Hi</h1>"})
	if err != nil {
		t.Fatalf("ExecuteNodeAlone: %v", err)
	}
	if !strings.Contains(out.Payload, "# Hi") {
		t.Fatalf("payload = %q, want the converted heading", out.Payload)
	}
	if v, ok := out.Attributes["count"]; !ok || v != 0.0 {
		t.Fatalf("attributes = %v, want the declared default seeded", out.Attributes)
	}
}

// Steps with nothing to run alone are refused by kind, and an unknown
// type by name -- never a silent pass-through of the input.
func TestExecuteNodeAlone_RefusesTriggersDecisionsAndUnknown(t *testing.T) {
	for _, node := range []Node{
		{ID: "t", NodeTypeID: "trigger-manual", Kind: KindTrigger},
		{ID: "d", NodeTypeID: "decision", Kind: KindDecision},
		{ID: "t2", NodeTypeID: "trigger-manual"}, // kind omitted: the registry answers
	} {
		if _, err := ExecuteNodeAlone(node, nil, ExecContext{Payload: "x"}); err == nil || !strings.Contains(err.Error(), "nothing to run on its own") {
			t.Fatalf("%s: err = %v, want the nothing-to-run refusal", node.ID, err)
		}
	}
	if _, err := ExecuteNodeAlone(Node{ID: "u", NodeTypeID: "no-such-step"}, nil, ExecContext{}); err == nil || !strings.Contains(err.Error(), "unknown step type") {
		t.Fatalf("unknown: err = %v", err)
	}
}
