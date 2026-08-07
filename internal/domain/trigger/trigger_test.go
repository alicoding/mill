package trigger

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
)

func TestExtractTrigger_FindsRootTriggerNode(t *testing.T) {
	wf := composition.Workflow{
		Nodes: []composition.Node{
			{ID: "t1", Kind: composition.KindTrigger, NodeTypeID: "trigger-hotkey", Config: map[string]string{}},
			{ID: "c1", Kind: composition.KindCapture, NodeTypeID: "capture-clipboard-html", Config: map[string]string{}},
		},
		Edges: []composition.Edge{{ID: "e1", Source: "t1", Target: "c1"}},
	}

	nodeTypeID, _, ok := ExtractTrigger(wf)
	if !ok {
		t.Fatal("ExtractTrigger() ok = false, want true")
	}
	if nodeTypeID != "trigger-hotkey" {
		t.Errorf("ExtractTrigger() nodeTypeID = %q, want %q", nodeTypeID, "trigger-hotkey")
	}
}

func TestExtractTrigger_ReturnsConfig(t *testing.T) {
	wf := composition.Workflow{
		Nodes: []composition.Node{
			{ID: "t1", Kind: composition.KindTrigger, NodeTypeID: "trigger-schedule", Config: map[string]string{"cron": "0 * * * *"}},
		},
	}

	_, config, ok := ExtractTrigger(wf)
	if !ok {
		t.Fatal("ExtractTrigger() ok = false, want true")
	}
	if config["cron"] != "0 * * * *" {
		t.Errorf("ExtractTrigger() config[cron] = %q, want %q", config["cron"], "0 * * * *")
	}
}

func TestExtractTrigger_NoTriggerNode(t *testing.T) {
	wf := composition.Workflow{
		Nodes: []composition.Node{
			{ID: "c1", Kind: composition.KindCapture, NodeTypeID: "capture-clipboard-html"},
		},
	}

	if _, _, ok := ExtractTrigger(wf); ok {
		t.Error("ExtractTrigger() ok = true for a workflow with no trigger node, want false")
	}
}

func TestExtractTrigger_RootIsNotATrigger(t *testing.T) {
	// A capture node as root (no trigger at all) shouldn't be mistaken
	// for one just because it has no incoming edge.
	wf := composition.Workflow{
		Nodes: []composition.Node{
			{ID: "c1", Kind: composition.KindCapture, NodeTypeID: "capture-clipboard-html"},
			{ID: "p1", Kind: composition.KindProcess, NodeTypeID: "process-html-to-markdown"},
		},
		Edges: []composition.Edge{{ID: "e1", Source: "c1", Target: "p1"}},
	}

	if _, _, ok := ExtractTrigger(wf); ok {
		t.Error("ExtractTrigger() ok = true for a workflow whose root isn't a trigger, want false")
	}
}

func TestCheckConflict_DetectsSameCombo(t *testing.T) {
	existing := []HotkeyBinding{
		{WorkflowID: "wf-a", Mods: []string{"cmd", "shift"}, Key: "M"},
	}

	conflict, found := CheckConflict(existing, []string{"cmd", "shift"}, "M", "wf-b")
	if !found {
		t.Fatal("CheckConflict() found = false, want true")
	}
	if conflict != "wf-a" {
		t.Errorf("CheckConflict() conflict = %q, want %q", conflict, "wf-a")
	}
}

func TestCheckConflict_ModOrderDoesNotMatter(t *testing.T) {
	existing := []HotkeyBinding{
		{WorkflowID: "wf-a", Mods: []string{"shift", "cmd"}, Key: "M"},
	}

	if _, found := CheckConflict(existing, []string{"cmd", "shift"}, "M", "wf-b"); !found {
		t.Error("CheckConflict() found = false for the same combo in a different mod order, want true")
	}
}

func TestCheckConflict_ExcludesOwnWorkflow(t *testing.T) {
	existing := []HotkeyBinding{
		{WorkflowID: "wf-a", Mods: []string{"cmd", "shift"}, Key: "M"},
	}

	// Re-assigning the same combo to the workflow that already owns it
	// (e.g. re-confirming, or a restore-at-startup re-registration) isn't
	// a conflict with itself.
	if _, found := CheckConflict(existing, []string{"cmd", "shift"}, "M", "wf-a"); found {
		t.Error("CheckConflict() found = true when the only match is the excluded workflow itself, want false")
	}
}

func TestCheckConflict_NoMatch(t *testing.T) {
	existing := []HotkeyBinding{
		{WorkflowID: "wf-a", Mods: []string{"cmd", "shift"}, Key: "M"},
	}

	if _, found := CheckConflict(existing, []string{"cmd"}, "K", "wf-b"); found {
		t.Error("CheckConflict() found = true for an unrelated combo, want false")
	}
}
