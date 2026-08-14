package configuresvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/decision"
	"github.com/alicoding/mill/internal/domain/execenv"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// captureEmits mirrors compositionsvc's own helper of the same name
// (see that package's compositionservice_dataevent_test.go for the
// full seam reasoning: application.Get() is always nil under `go
// test`, so dataevent.TestHook is the only way to observe an Emit
// call). Package-local since dataevent.TestHook is shared, mutable
// package state -- every test using it must t.Cleanup it back to nil.
func captureEmits(t *testing.T) *[]dataevent.Changed {
	t.Helper()
	var got []dataevent.Changed
	dataevent.TestHook = func(entity, id string) {
		got = append(got, dataevent.Changed{Entity: entity, ID: id})
	}
	t.Cleanup(func() { dataevent.TestHook = nil })
	return &got
}

func assertEmitted(t *testing.T, got []dataevent.Changed, entity, id string) {
	t.Helper()
	for _, c := range got {
		if c.Entity == entity && c.ID == id {
			return
		}
	}
	t.Errorf("dataevent.Emit(%q, %q) was not observed; got %+v", entity, id, got)
}

// TestDataEvent_RequestMutations proves goal 0017's P0-2 for
// HTTPRequests: Create/Update/Delete all emit
// mill-data-changed{entity:"request"}.
func TestDataEvent_RequestMutations(t *testing.T) {
	cfg, _ := newTestConfigureService(t)

	got := captureEmits(t)
	req, err := cfg.CreateHTTPRequest("Emit test request", "https://example.com", "GET", "", httprequest.AuthNone, nil, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}
	assertEmitted(t, *got, "request", req.ID)

	got = captureEmits(t)
	updated, err := cfg.UpdateHTTPRequest(req.ID, "Emit test request (edited)", "https://example.com", "GET", "", httprequest.AuthNone, nil, "", nil, nil, "")
	if err != nil {
		t.Fatalf("UpdateHTTPRequest: %v", err)
	}
	assertEmitted(t, *got, "request", updated.ID)

	got = captureEmits(t)
	if err := cfg.DeleteHTTPRequest(req.ID); err != nil {
		t.Fatalf("DeleteHTTPRequest: %v", err)
	}
	assertEmitted(t, *got, "request", req.ID)
}

// TestDataEvent_ListMutations proves goal 0017's P0-2 for Lists:
// Create/Update/AddRow/UpdateRow/DeleteRow/Delete all emit
// mill-data-changed{entity:"list"}.
func TestDataEvent_ListMutations(t *testing.T) {
	cfg, _ := newTestConfigureService(t)

	got := captureEmits(t)
	l, err := cfg.CreateList("Emit test list", "", nil)
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}
	assertEmitted(t, *got, "list", l.ID)

	got = captureEmits(t)
	l, err = cfg.UpdateList(l.ID, "Emit test list (edited)", "", nil)
	if err != nil {
		t.Fatalf("UpdateList: %v", err)
	}
	assertEmitted(t, *got, "list", l.ID)

	got = captureEmits(t)
	l, err = cfg.AddListRow(l.ID, map[string]string{"k": "v"})
	if err != nil {
		t.Fatalf("AddListRow: %v", err)
	}
	assertEmitted(t, *got, "list", l.ID)
	rowID := l.Rows[0].ID

	got = captureEmits(t)
	l, err = cfg.UpdateListRow(l.ID, rowID, map[string]string{"k": "v2"}, "")
	if err != nil {
		t.Fatalf("UpdateListRow: %v", err)
	}
	assertEmitted(t, *got, "list", l.ID)

	got = captureEmits(t)
	l, err = cfg.DeleteListRow(l.ID, rowID)
	if err != nil {
		t.Fatalf("DeleteListRow: %v", err)
	}
	assertEmitted(t, *got, "list", l.ID)

	got = captureEmits(t)
	if err := cfg.DeleteList(l.ID); err != nil {
		t.Fatalf("DeleteList: %v", err)
	}
	assertEmitted(t, *got, "list", l.ID)
}

// TestDataEvent_MCPServerMutations proves goal 0017's P0-2 for
// configured MCP Servers.
func TestDataEvent_MCPServerMutations(t *testing.T) {
	cfg, _ := newTestConfigureService(t)

	got := captureEmits(t)
	s, err := cfg.CreateMCPServer("Emit test server", "echo", nil)
	if err != nil {
		t.Fatalf("CreateMCPServer: %v", err)
	}
	assertEmitted(t, *got, "mcpserver", s.ID)

	got = captureEmits(t)
	s, err = cfg.UpdateMCPServer(s.ID, "Emit test server (edited)", "echo", nil)
	if err != nil {
		t.Fatalf("UpdateMCPServer: %v", err)
	}
	assertEmitted(t, *got, "mcpserver", s.ID)

	got = captureEmits(t)
	if err := cfg.DeleteMCPServer(s.ID); err != nil {
		t.Fatalf("DeleteMCPServer: %v", err)
	}
	assertEmitted(t, *got, "mcpserver", s.ID)
}

// TestDataEvent_DecisionMutations proves goal 0017's P0-2 for
// Decisions -- "decision" is a NEW entity string on the wire, not
// covered by App.tsx's routing before this goal.
func TestDataEvent_DecisionMutations(t *testing.T) {
	cfg, _ := newTestConfigureService(t)

	got := captureEmits(t)
	d, err := cfg.CreateDecision("Emit test decision", decision.CategoryApprove, nil, "")
	if err != nil {
		t.Fatalf("CreateDecision: %v", err)
	}
	assertEmitted(t, *got, "decision", d.ID)

	got = captureEmits(t)
	d, err = cfg.UpdateDecision(d.ID, "Emit test decision (edited)", decision.CategoryApprove, nil, "")
	if err != nil {
		t.Fatalf("UpdateDecision: %v", err)
	}
	assertEmitted(t, *got, "decision", d.ID)

	got = captureEmits(t)
	if err := cfg.DeleteDecision(d.ID); err != nil {
		t.Fatalf("DeleteDecision: %v", err)
	}
	assertEmitted(t, *got, "decision", d.ID)
}

// TestDataEvent_ExecEnvMutations proves goal 0017's P0-2 for Execution
// Environments -- "execenv" is a NEW entity string on the wire.
func TestDataEvent_ExecEnvMutations(t *testing.T) {
	cfg, _ := newTestConfigureService(t)

	got := captureEmits(t)
	e, err := cfg.CreateExecEnv("Emit test execenv", execenv.ShellBash, execenv.ProfileClean, execenv.TempDirSentinel, nil)
	if err != nil {
		t.Fatalf("CreateExecEnv: %v", err)
	}
	assertEmitted(t, *got, "execenv", e.ID)

	got = captureEmits(t)
	e, err = cfg.UpdateExecEnv(e.ID, "Emit test execenv (edited)", execenv.ShellBash, execenv.ProfileClean, execenv.TempDirSentinel, nil)
	if err != nil {
		t.Fatalf("UpdateExecEnv: %v", err)
	}
	assertEmitted(t, *got, "execenv", e.ID)

	got = captureEmits(t)
	if err := cfg.DeleteExecEnv(e.ID); err != nil {
		t.Fatalf("DeleteExecEnv: %v", err)
	}
	assertEmitted(t, *got, "execenv", e.ID)
}

// TestDataEvent_AIProviderMutations proves goal 0017's P0-2 for AI
// Providers -- "aiprovider" is a NEW entity string on the wire
// (goal 0031's AI node family).
func TestDataEvent_AIProviderMutations(t *testing.T) {
	cfg, _ := newTestConfigureService(t)

	got := captureEmits(t)
	p, err := cfg.CreateAIProvider("Emit test provider", aiprovider.KindAnthropic, "", "claude")
	if err != nil {
		t.Fatalf("CreateAIProvider: %v", err)
	}
	assertEmitted(t, *got, "aiprovider", p.ID)

	got = captureEmits(t)
	p, err = cfg.UpdateAIProvider(p.ID, "Emit test provider (edited)", aiprovider.KindAnthropic, "", "claude")
	if err != nil {
		t.Fatalf("UpdateAIProvider: %v", err)
	}
	assertEmitted(t, *got, "aiprovider", p.ID)

	got = captureEmits(t)
	if err := cfg.DeleteAIProvider(p.ID); err != nil {
		t.Fatalf("DeleteAIProvider: %v", err)
	}
	assertEmitted(t, *got, "aiprovider", p.ID)
}

// TestDataEvent_UpdateWorkflowAttributes_DelegatesToComposition proves
// goal 0017's "workflow-attributes changes" item: ConfigureService's
// delegate emits "workflow" via CompositionService.UpdateAttributes,
// not a second, separate emit -- one source of truth for the workflow
// entity's live-sync event.
func TestDataEvent_UpdateWorkflowAttributes_DelegatesToComposition(t *testing.T) {
	cfg, comp := newTestConfigureService(t)
	wf, err := comp.CreateWorkflow("Attrs-target wf", "", []composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}}, nil)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	got := captureEmits(t)
	if _, err := cfg.UpdateWorkflowAttributes(wf.ID, nil); err != nil {
		t.Fatalf("UpdateWorkflowAttributes: %v", err)
	}
	assertEmitted(t, *got, "workflow", wf.ID)
}
