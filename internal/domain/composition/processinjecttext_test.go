package composition

import "testing"

// These tests deliberately avoid any adapter (clipboard, markdown) --
// process-inject-text only ever reads/writes ExecContext.Payload, so a
// pure chain of trigger-manual + process-inject-text nodes is enough to
// exercise it through the real ExecuteWorkflow path.

func TestExecuteWorkflow_InjectText_AppendsToPayload(t *testing.T) {
	nodes, edges := chain("trigger-manual", "process-inject-text")
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	for i := range resolved {
		if resolved[i].NodeTypeID == "process-inject-text" {
			resolved[i].Config["text"] = "hello"
			resolved[i].Config["placement"] = "append"
		}
	}

	result, err := ExecuteWorkflow(resolved, edges, nil)
	if err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	// Payload starts empty, so no separator is expected before the
	// injected text.
	if result != "hello" {
		t.Errorf("ExecuteWorkflow result = %q, want %q", result, "hello")
	}
}

func TestExecuteWorkflow_InjectText_PrependIsAppliedBeforeExistingPayload(t *testing.T) {
	nodes := []Node{
		{ID: "trigger", NodeTypeID: "trigger-manual"},
		{ID: "build", NodeTypeID: "process-inject-text", Config: map[string]string{"text": "world", "placement": "append"}},
		{ID: "prepend", NodeTypeID: "process-inject-text", Config: map[string]string{"text": "hello", "placement": "prepend"}},
	}
	edges := []Edge{
		{ID: "e0", Source: "trigger", Target: "build"},
		{ID: "e1", Source: "build", Target: "prepend"},
	}
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}

	result, err := ExecuteWorkflow(resolved, edges, nil)
	if err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	want := "hello\n\nworld"
	if result != want {
		t.Errorf("ExecuteWorkflow result = %q, want %q", result, want)
	}
}

func TestExecuteWorkflow_InjectText_EmptyText_IsNoOp(t *testing.T) {
	nodes := []Node{
		{ID: "trigger", NodeTypeID: "trigger-manual"},
		{ID: "build", NodeTypeID: "process-inject-text", Config: map[string]string{"text": "hello", "placement": "append"}},
		// No "text" override -- resolves to the field's own default (""),
		// which must leave the payload untouched.
		{ID: "noop", NodeTypeID: "process-inject-text"},
	}
	edges := []Edge{
		{ID: "e0", Source: "trigger", Target: "build"},
		{ID: "e1", Source: "build", Target: "noop"},
	}
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}

	result, err := ExecuteWorkflow(resolved, edges, nil)
	if err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if result != "hello" {
		t.Errorf("ExecuteWorkflow result = %q, want %q (an empty \"text\" field must not touch the payload)", result, "hello")
	}
}

func TestResolveNodeDefaults_InjectText_DefaultsToAppendAndEmptyText(t *testing.T) {
	resolved, err := ResolveNodeDefaults([]Node{{NodeTypeID: "process-inject-text"}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if got := resolved[0].Config["text"]; got != "" {
		t.Errorf(`Config["text"] = %q, want "" (the field's own default)`, got)
	}
	if got := resolved[0].Config["placement"]; got != "append" {
		t.Errorf(`Config["placement"] = %q, want "append" (the field's own default)`, got)
	}
}

func TestResolveNodeDefaults_InjectText_RejectsInvalidPlacement(t *testing.T) {
	_, err := ResolveNodeDefaults([]Node{
		{NodeTypeID: "process-inject-text", Config: map[string]string{"placement": "sideways"}},
	})
	if err == nil {
		t.Fatal(`ResolveNodeDefaults with placement="sideways": want an error (not one of the declared Options), got nil`)
	}
}

// TestExecuteWorkflow_InjectText_ComposesWithDecision proves conditional
// injection needs no branching logic inside process-inject-text itself
// -- composing it behind an upstream Decision node is enough (SPEC.md
// §3.3's Decision row), the same design choice applytext.go/applyhtml.go
// already lean on for every other Process/Apply node.
func TestExecuteWorkflow_InjectText_ComposesWithDecision(t *testing.T) {
	const hint = "hint: other tools are available"
	nodes := []Node{
		{ID: "d", NodeTypeID: "decision-route"},
		{ID: "inject", NodeTypeID: "process-inject-text", Config: map[string]string{"text": hint, "placement": "append"}},
		// The non-matching branch's terminal node -- deliberately a
		// second process-inject-text with no text override (a no-op),
		// so the hint node is provably never reached rather than merely
		// never mattering.
		{ID: "skip", NodeTypeID: "process-inject-text"},
	}
	edges := []Edge{
		{ID: "d-yes", Source: "d", Target: "inject", SourceHandle: "urgent == true"},
		{ID: "d-no", Source: "d", Target: "skip", SourceHandle: otherwiseHandle},
	}
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	attrs := []AttributeDef{{Key: "urgent", Label: "Urgent", Type: FieldBoolean}}

	// urgent defaults to false (its zero value) -- routes to "skip", so
	// the hint is never injected.
	skipped, err := ExecuteWorkflow(resolved, edges, attrs)
	if err != nil {
		t.Fatalf("ExecuteWorkflow (urgent=false) returned error: %v", err)
	}
	if skipped != "" {
		t.Errorf("ExecuteWorkflow (urgent=false) result = %q, want empty (hint not injected)", skipped)
	}

	// urgent=true -- routes to "inject", so the hint is appended.
	injected, err := ExecuteWorkflow(resolved, edges, attrs, ExecuteOptions{AttrValues: map[string]string{"urgent": "true"}})
	if err != nil {
		t.Fatalf("ExecuteWorkflow (urgent=true) returned error: %v", err)
	}
	if injected != hint {
		t.Errorf("ExecuteWorkflow (urgent=true) result = %q, want %q", injected, hint)
	}
}
