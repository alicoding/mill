package composition

import (
	"strings"
	"testing"
)

// Explicit list-lookup miss behavior (goal 0001 node maturity): fail
// (default, preserves legacy), continue (proceed unchanged), default
// (write a fallback). Backed by an injected list.
func TestListLookup_MissBehavior(t *testing.T) {
	SetListLookup(func(string, int) (ResolvedList, error) {
		return ResolvedList{Entries: map[string]string{"US": "United States"}}, nil
	})
	t.Cleanup(func() {
		SetListLookup(func(id string, _ int) (ResolvedList, error) {
			return ResolvedList{}, nil
		})
	})

	attrs := []AttributeDef{
		{Key: "code", Label: "Code", Type: FieldText},
		{Key: "name", Label: "Name", Type: FieldText},
	}
	run := func(onMiss, defVal, input string) (string, error) {
		nodes := []Node{
			{ID: "t", NodeTypeID: "trigger-manual"},
			{ID: "l", NodeTypeID: "list-lookup", Config: map[string]string{
				"listId": "x", "inputKey": "code", "outputKey": "name",
				"onMiss": onMiss, "defaultValue": defVal,
			}},
			{ID: "c", NodeTypeID: "capture-attribute", Config: map[string]string{"attribute": "name"}},
		}
		edges := []Edge{{ID: "e1", Source: "t", Target: "l"}, {ID: "e2", Source: "l", Target: "c"}}
		resolved, err := ResolveNodeDefaults(nodes)
		if err != nil {
			t.Fatal(err)
		}
		return ExecuteWorkflow(resolved, edges, attrs, ExecuteOptions{AttrValues: map[string]string{"code": input}})
	}

	// Hit: matched value flows regardless of onMiss.
	if out, err := run("fail", "", "US"); err != nil || out != "United States" {
		t.Fatalf("hit: out=%q err=%v", out, err)
	}
	// Miss + fail (the legacy default): errors.
	if _, err := run("fail", "", "ZZ"); err == nil || !strings.Contains(err.Error(), "no entry") {
		t.Fatalf("miss/fail should error, got %v", err)
	}
	// Miss + continue: proceeds, output attribute stays empty.
	if out, err := run("continue", "", "ZZ"); err != nil || out != "" {
		t.Fatalf("miss/continue: out=%q err=%v", out, err)
	}
	// Miss + default: writes the fallback.
	if out, err := run("default", "Unknown", "ZZ"); err != nil || out != "Unknown" {
		t.Fatalf("miss/default: out=%q err=%v", out, err)
	}
	// A legacy node persisted before onMiss existed has no such key;
	// ResolveNodeDefaults fills the "fail" default, so it errors on a
	// miss exactly as before -- verified by omitting the key entirely.
	legacy := []Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "l", NodeTypeID: "list-lookup", Config: map[string]string{
			"listId": "x", "inputKey": "code", "outputKey": "name",
		}},
	}
	resolved, err := ResolveNodeDefaults(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if resolved[1].Config["onMiss"] != "fail" {
		t.Fatalf("legacy node's onMiss defaulted to %q, want fail", resolved[1].Config["onMiss"])
	}
}
