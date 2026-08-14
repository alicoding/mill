package compositionsvc

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
)

// swapHTTPRequestLookup installs fn as composition's HTTP-request lookup
// seam for the duration of one test and restores integration.go's own
// "nothing registered" default afterward -- composition.SetHTTPRequestLookup
// is a bare package var with no test-scoped accessor
// (executionsvc/guardedhttp_seed_test.go establishes this exact swap/
// restore shape; this package doesn't construct a real ConfigureService
// in its tests, so there's no other "original" value to save).
func swapHTTPRequestLookup(t *testing.T, fn func(id string) (composition.ResolvedHTTPRequest, error)) {
	t.Helper()
	composition.SetHTTPRequestLookup(fn)
	t.Cleanup(func() {
		composition.SetHTTPRequestLookup(func(id string) (composition.ResolvedHTTPRequest, error) {
			return composition.ResolvedHTTPRequest{}, fmt.Errorf("no request lookup registered (yet) for id %q", id)
		})
	})
}

// docs/goals/0039: "Apply from clipboard..." reuses exportedWorkflow
// (compositionservice_export.go) with one addition -- an optional id
// that flips create into update. These tests cover the three
// id-presence branches (absent/matching/unknown) for both
// PreviewClipboardApply and ConfirmClipboardApply, plus the dangling-
// reference walk.

func exportedWorkflowJSON(t *testing.T, in exportedWorkflow) string {
	t.Helper()
	data, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal exportedWorkflow: %v", err)
	}
	return string(data)
}

func TestPreviewClipboardApply_MalformedJSON_ReturnsReadableErrorNotGoError(t *testing.T) {
	comp := newTestCompositionService(t)
	preview, err := comp.PreviewClipboardApply("not json at all")
	if err != nil {
		t.Fatalf("PreviewClipboardApply returned a Go error for malformed JSON: %v -- should be a value-level Error instead", err)
	}
	if preview.Recognized {
		t.Error("preview.Recognized = true for malformed JSON, want false")
	}
	if preview.Error == "" {
		t.Error("preview.Error is empty for malformed JSON, want a readable message")
	}
}

func TestPreviewClipboardApply_UnrecognizedShape_ReturnsReadableError(t *testing.T) {
	comp := newTestCompositionService(t)
	// A valid JSON document, but not a workflow shape (no nodes/edges) --
	// e.g. an HTTPRequest export (configureservice_export.go).
	preview, err := comp.PreviewClipboardApply(`{"label":"an integration","baseURL":"https://example.com","method":"GET"}`)
	if err != nil {
		t.Fatalf("PreviewClipboardApply returned a Go error: %v", err)
	}
	if preview.Recognized {
		t.Error("preview.Recognized = true for a non-workflow shape, want false")
	}
	if preview.Error == "" {
		t.Error("preview.Error is empty for an unrecognized shape, want a readable message")
	}
}

// TestPreviewClipboardApply_UnsupportedSchemaMajor_ReturnsReadableError
// pins ADR-0036 decision 2's import rule reaching the clipboard-apply
// preview path too, not just the seven Import* methods: a schema value
// naming a major this build doesn't support is rejected as a value-
// level Error, same as any other malformed/unrecognized payload.
func TestPreviewClipboardApply_UnsupportedSchemaMajor_ReturnsReadableError(t *testing.T) {
	comp := newTestCompositionService(t)
	nodes, edges := triggerAndCaptureNodes()
	payload := exportedWorkflowJSON(t, exportedWorkflow{Schema: "mill://schema/workflow/v99", Label: "future export", Nodes: nodes, Edges: edges})

	preview, err := comp.PreviewClipboardApply(payload)
	if err != nil {
		t.Fatalf("PreviewClipboardApply returned a Go error: %v", err)
	}
	if preview.Recognized {
		t.Error("preview.Recognized = true for an unsupported schema major, want false")
	}
	if preview.Error == "" {
		t.Error("preview.Error is empty for an unsupported schema major, want a readable message")
	}
}

func TestPreviewClipboardApply_NoID_DetectsCreate(t *testing.T) {
	comp := newTestCompositionService(t)
	nodes, edges := triggerAndCaptureNodes()
	payload := exportedWorkflowJSON(t, exportedWorkflow{Label: "new one", Nodes: nodes, Edges: edges})

	preview, err := comp.PreviewClipboardApply(payload)
	if err != nil {
		t.Fatalf("PreviewClipboardApply: %v", err)
	}
	if !preview.Recognized {
		t.Fatalf("preview.Recognized = false, want true; Error=%q", preview.Error)
	}
	if preview.Action != ClipboardApplyActionCreate {
		t.Errorf("preview.Action = %q, want %q", preview.Action, ClipboardApplyActionCreate)
	}
	if preview.NodeCount != 2 {
		t.Errorf("preview.NodeCount = %d, want 2", preview.NodeCount)
	}
}

func TestPreviewClipboardApply_MatchingID_DetectsUpdate(t *testing.T) {
	comp := newTestCompositionService(t)
	nodes, edges := triggerAndCaptureNodes()
	existing, err := comp.CreateWorkflow("existing workflow", "", nodes, edges)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	payload := exportedWorkflowJSON(t, exportedWorkflow{ID: existing.ID, Label: "renamed", Nodes: nodes, Edges: edges})
	preview, err := comp.PreviewClipboardApply(payload)
	if err != nil {
		t.Fatalf("PreviewClipboardApply: %v", err)
	}
	if preview.Action != ClipboardApplyActionUpdate {
		t.Errorf("preview.Action = %q, want %q", preview.Action, ClipboardApplyActionUpdate)
	}
	if preview.WorkflowID != existing.ID {
		t.Errorf("preview.WorkflowID = %q, want %q", preview.WorkflowID, existing.ID)
	}
	if preview.Note != "" {
		t.Errorf("preview.Note = %q, want empty for a real match", preview.Note)
	}
}

func TestPreviewClipboardApply_UnknownID_DetectsCreateWithNote(t *testing.T) {
	comp := newTestCompositionService(t)
	nodes, edges := triggerAndCaptureNodes()
	payload := exportedWorkflowJSON(t, exportedWorkflow{ID: "no-such-workflow-id", Label: "orphaned id", Nodes: nodes, Edges: edges})

	preview, err := comp.PreviewClipboardApply(payload)
	if err != nil {
		t.Fatalf("PreviewClipboardApply: %v", err)
	}
	if preview.Action != ClipboardApplyActionCreate {
		t.Errorf("preview.Action = %q, want %q (id present but unknown)", preview.Action, ClipboardApplyActionCreate)
	}
	if preview.Note == "" {
		t.Error("preview.Note is empty for an unknown id, want a note explaining create-instead-of-update")
	}
}

func TestConfirmClipboardApply_NoID_CreatesNewWorkflow(t *testing.T) {
	comp := newTestCompositionService(t)
	nodes, edges := triggerAndCaptureNodes()
	payload := exportedWorkflowJSON(t, exportedWorkflow{Label: "created via clipboard", Nodes: nodes, Edges: edges})

	wf, err := comp.ConfirmClipboardApply(payload)
	if err != nil {
		t.Fatalf("ConfirmClipboardApply: %v", err)
	}
	if wf.Label != "created via clipboard" {
		t.Errorf("wf.Label = %q, want %q", wf.Label, "created via clipboard")
	}
	if len(comp.Workflows()) != 1 {
		t.Errorf("Workflows() has %d entries, want 1", len(comp.Workflows()))
	}
}

func TestConfirmClipboardApply_MatchingID_UpdatesThroughSnapshotDraft(t *testing.T) {
	comp := newTestCompositionService(t)
	nodes, edges := triggerAndCaptureNodes()
	existing, err := comp.CreateWorkflow("original label", "", nodes, edges)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	if len(existing.Versions) != 0 {
		t.Fatalf("fresh workflow already has %d versions, want 0", len(existing.Versions))
	}

	updatedNodes, updatedEdges := triggerAndCaptureNodes()
	payload := exportedWorkflowJSON(t, exportedWorkflow{ID: existing.ID, Label: "updated label", Nodes: updatedNodes, Edges: updatedEdges})

	wf, err := comp.ConfirmClipboardApply(payload)
	if err != nil {
		t.Fatalf("ConfirmClipboardApply: %v", err)
	}
	if wf.ID != existing.ID {
		t.Errorf("wf.ID = %q, want %q (update must keep the same identity)", wf.ID, existing.ID)
	}
	if wf.Label != "updated label" {
		t.Errorf("wf.Label = %q, want %q", wf.Label, "updated label")
	}
	// SnapshotDraft ran first -- the previous draft ("original label") is
	// now recorded as a version, matching the same chokepoint MCP's
	// update_workflow tool uses (millmcpservice_authoring.go).
	if len(wf.Versions) != 1 {
		t.Fatalf("wf.Versions has %d entries, want 1 (the pre-update draft snapshotted)", len(wf.Versions))
	}
	if wf.Versions[0].Label != "original label" {
		t.Errorf("wf.Versions[0].Label = %q, want %q (the snapshot of the draft BEFORE this update)", wf.Versions[0].Label, "original label")
	}
	if len(comp.Workflows()) != 1 {
		t.Errorf("Workflows() has %d entries, want 1 (an update must never create a second workflow)", len(comp.Workflows()))
	}
}

// TestConfirmClipboardApply_UnknownID_CreatesPreservingIt pins ADR-0036
// decision 3: an id this instance has never seen creates a new
// workflow AT that id, not a freshly minted one -- the two-machine
// bridge identity the ADR exists for.
func TestConfirmClipboardApply_UnknownID_CreatesPreservingIt(t *testing.T) {
	comp := newTestCompositionService(t)
	nodes, edges := triggerAndCaptureNodes()
	payload := exportedWorkflowJSON(t, exportedWorkflow{ID: "does-not-exist-locally", Label: "orphaned id create", Nodes: nodes, Edges: edges})

	wf, err := comp.ConfirmClipboardApply(payload)
	if err != nil {
		t.Fatalf("ConfirmClipboardApply with an unknown id returned an error, want a fallback create: %v", err)
	}
	if wf.ID != "does-not-exist-locally" {
		t.Errorf("ConfirmClipboardApply.ID = %q, want the preserved id %q", wf.ID, "does-not-exist-locally")
	}
	if len(comp.Workflows()) != 1 {
		t.Errorf("Workflows() has %d entries, want 1", len(comp.Workflows()))
	}
}

func TestConfirmClipboardApply_InvalidGraphShape_Rejected(t *testing.T) {
	comp := newTestCompositionService(t)
	// Two roots -- ValidateGraph's own rejection, same bar ImportWorkflow
	// already holds hand-authored files to (compositionservice_export_test.go).
	badJSON := `{"label":"bad","nodes":[{"nodeTypeID":"trigger-manual"},{"nodeTypeID":"trigger-manual"}],"edges":[]}`
	if _, err := comp.ConfirmClipboardApply(badJSON); err == nil {
		t.Error("ConfirmClipboardApply with two root nodes returned nil error, want ValidateGraph's rejection")
	}
}

func TestPreviewClipboardApply_UnresolvedRefs_UnknownNodeType(t *testing.T) {
	comp := newTestCompositionService(t)
	nodes := []composition.Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "bogus", NodeTypeID: "totally-not-a-real-node-type"},
	}
	edges := []composition.Edge{{ID: "e1", Source: "t", Target: "bogus"}}
	payload := exportedWorkflowJSON(t, exportedWorkflow{Label: "unknown node type", Nodes: nodes, Edges: edges})

	preview, err := comp.PreviewClipboardApply(payload)
	if err != nil {
		t.Fatalf("PreviewClipboardApply: %v", err)
	}
	if len(preview.Unresolved) != 1 {
		t.Fatalf("preview.Unresolved has %d entries, want 1; got %+v", len(preview.Unresolved), preview.Unresolved)
	}
	got := preview.Unresolved[0]
	if got.NodeID != "bogus" || got.RefKind != "node-type" || got.Value != "totally-not-a-real-node-type" {
		t.Errorf("preview.Unresolved[0] = %+v, want NodeID=bogus RefKind=node-type Value=totally-not-a-real-node-type", got)
	}
}

func TestPreviewClipboardApply_UnresolvedRefs_DanglingRequestRef(t *testing.T) {
	comp := newTestCompositionService(t)
	swapHTTPRequestLookup(t, func(id string) (composition.ResolvedHTTPRequest, error) {
		if id == "real-request-id" {
			return composition.ResolvedHTTPRequest{}, nil
		}
		return composition.ResolvedHTTPRequest{}, fmt.Errorf("no such request %q", id)
	})

	nodes := []composition.Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "http", NodeTypeID: "integration-http", Config: map[string]string{"requestId": "ghost-request-id"}},
	}
	edges := []composition.Edge{{ID: "e1", Source: "t", Target: "http"}}
	payload := exportedWorkflowJSON(t, exportedWorkflow{Label: "dangling request ref", Nodes: nodes, Edges: edges})

	preview, err := comp.PreviewClipboardApply(payload)
	if err != nil {
		t.Fatalf("PreviewClipboardApply: %v", err)
	}
	if len(preview.Unresolved) != 1 {
		t.Fatalf("preview.Unresolved has %d entries, want 1; got %+v", len(preview.Unresolved), preview.Unresolved)
	}
	got := preview.Unresolved[0]
	if got.NodeID != "http" || got.Field != "requestId" || got.RefKind != "request" || got.Value != "ghost-request-id" {
		t.Errorf("preview.Unresolved[0] = %+v, want NodeID=http Field=requestId RefKind=request Value=ghost-request-id", got)
	}
}

func TestPreviewClipboardApply_ResolvedRequestRef_NotFlagged(t *testing.T) {
	comp := newTestCompositionService(t)
	swapHTTPRequestLookup(t, func(id string) (composition.ResolvedHTTPRequest, error) {
		if id == "real-request-id" {
			return composition.ResolvedHTTPRequest{}, nil
		}
		return composition.ResolvedHTTPRequest{}, fmt.Errorf("no such request %q", id)
	})

	nodes := []composition.Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "http", NodeTypeID: "integration-http", Config: map[string]string{"requestId": "real-request-id"}},
	}
	edges := []composition.Edge{{ID: "e1", Source: "t", Target: "http"}}
	payload := exportedWorkflowJSON(t, exportedWorkflow{Label: "resolved request ref", Nodes: nodes, Edges: edges})

	preview, err := comp.PreviewClipboardApply(payload)
	if err != nil {
		t.Fatalf("PreviewClipboardApply: %v", err)
	}
	if len(preview.Unresolved) != 0 {
		t.Errorf("preview.Unresolved = %+v, want empty for a resolved reference", preview.Unresolved)
	}
}

func TestPreviewClipboardApply_EmptyRef_NotFlaggedAsDangling(t *testing.T) {
	comp := newTestCompositionService(t)
	nodes := []composition.Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "http", NodeTypeID: "integration-http", Config: map[string]string{}},
	}
	edges := []composition.Edge{{ID: "e1", Source: "t", Target: "http"}}
	payload := exportedWorkflowJSON(t, exportedWorkflow{Label: "unset ref, not dangling", Nodes: nodes, Edges: edges})

	preview, err := comp.PreviewClipboardApply(payload)
	if err != nil {
		t.Fatalf("PreviewClipboardApply: %v", err)
	}
	if len(preview.Unresolved) != 0 {
		t.Errorf("preview.Unresolved = %+v, want empty -- an unset RefKind value is 'not configured yet' (ValidateGraph's own separate warning), not a dangling reference", preview.Unresolved)
	}
}

func TestPreviewClipboardApply_DanglingWorkflowRef(t *testing.T) {
	comp := newTestCompositionService(t)
	nodes := []composition.Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "child", NodeTypeID: "child-workflow", Config: map[string]string{"workflowId": "ghost-workflow-id"}},
	}
	edges := []composition.Edge{{ID: "e1", Source: "t", Target: "child"}}
	payload := exportedWorkflowJSON(t, exportedWorkflow{Label: "dangling workflow ref", Nodes: nodes, Edges: edges})

	preview, err := comp.PreviewClipboardApply(payload)
	if err != nil {
		t.Fatalf("PreviewClipboardApply: %v", err)
	}
	if len(preview.Unresolved) != 1 {
		t.Fatalf("preview.Unresolved has %d entries, want 1; got %+v", len(preview.Unresolved), preview.Unresolved)
	}
	got := preview.Unresolved[0]
	if got.NodeID != "child" || got.Field != "workflowId" || got.RefKind != "workflow" {
		t.Errorf("preview.Unresolved[0] = %+v, want NodeID=child Field=workflowId RefKind=workflow", got)
	}
}

func TestPreviewClipboardApply_ResolvedWorkflowRef_NotFlagged(t *testing.T) {
	comp := newTestCompositionService(t)
	targetNodes, targetEdges := triggerAndCaptureNodes()
	target, err := comp.CreateWorkflow("callable target", "", targetNodes, targetEdges)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	nodes := []composition.Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "child", NodeTypeID: "child-workflow", Config: map[string]string{"workflowId": target.ID}},
	}
	edges := []composition.Edge{{ID: "e1", Source: "t", Target: "child"}}
	payload := exportedWorkflowJSON(t, exportedWorkflow{Label: "resolved workflow ref", Nodes: nodes, Edges: edges})

	preview, err := comp.PreviewClipboardApply(payload)
	if err != nil {
		t.Fatalf("PreviewClipboardApply: %v", err)
	}
	if len(preview.Unresolved) != 0 {
		t.Errorf("preview.Unresolved = %+v, want empty for a workflowId that matches a real local workflow", preview.Unresolved)
	}
}

// TestClipboardApply_ExportModifyReimport_UpdatesTheSameIDWithSnapshot
// is ADR-0036's far-side-shaped round trip (goal 0052 acceptance box
// 4): ExportWorkflow (now carrying id) -> a far-side edit to the raw
// JSON -> back through the real clipboard-apply confirm path. Asserts
// the SAME id was updated (never a second workflow created) and the
// pre-edit state survived as a snapshot -- the two-machine bridge
// (export at work, refine elsewhere, write back by id) this ADR exists
// for.
func TestClipboardApply_ExportModifyReimport_UpdatesTheSameIDWithSnapshot(t *testing.T) {
	comp := newTestCompositionService(t)
	nodes, edges := triggerAndCaptureNodes()
	original, err := comp.CreateWorkflow("Bridge original", "before the far side touched it", nodes, edges)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	exported, err := comp.ExportWorkflow(original.ID)
	if err != nil {
		t.Fatalf("ExportWorkflow: %v", err)
	}

	// The far side edits the raw JSON document directly -- exactly what
	// an external agent with no Mill UI access does -- never a Go struct.
	var raw map[string]any
	if err := json.Unmarshal([]byte(exported), &raw); err != nil {
		t.Fatalf("exported output is not valid JSON: %v", err)
	}
	raw["label"] = "Bridge edited far side"
	edited, err := json.Marshal(raw)
	if err != nil {
		t.Fatalf("re-marshal edited payload: %v", err)
	}

	confirmed, err := comp.ConfirmClipboardApply(string(edited))
	if err != nil {
		t.Fatalf("ConfirmClipboardApply: %v", err)
	}

	if confirmed.ID != original.ID {
		t.Fatalf("ConfirmClipboardApply.ID = %q, want the original id %q (update, not create)", confirmed.ID, original.ID)
	}
	if confirmed.Label != "Bridge edited far side" {
		t.Errorf("confirmed.Label = %q, want the far side's edit applied", confirmed.Label)
	}
	if got := len(comp.Workflows()); got != 1 {
		t.Fatalf("Workflows() has %d entries, want 1 (updated in place, no duplicate)", got)
	}

	// The prior state (pre-edit label) is recoverable -- SnapshotDraft
	// ran before the write (ConfirmClipboardApply -> ImportWorkflow's
	// known-id branch), so it's in Versions, not lost.
	updated := comp.Workflows()[0]
	if len(updated.Versions) == 0 {
		t.Fatal("updated workflow has no Versions -- the pre-write snapshot never happened")
	}
	last := updated.Versions[len(updated.Versions)-1]
	if last.Label != "Bridge original" {
		t.Errorf("snapshot Versions[-1].Label = %q, want the pre-edit label %q", last.Label, "Bridge original")
	}
}
