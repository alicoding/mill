package mcpsvc

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/alicoding/mill/internal/contract"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// TestMillMCPService_Skill_ReadsCommittedDoc proves mill://skill serves
// the exact committed userdocs/agents/skill.md byte-for-byte -- no
// second copy, nothing to regenerate or drift (goal 0160).
func TestMillMCPService_Skill_ReadsCommittedDoc(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})
	userdocs := fstest.MapFS{
		skillDocPath: {Data: []byte("---\nname: working-with-mill\n---\n\nhello\n")},
	}
	svc := NewMillMCPService("0.0.0-test", comp, cfg, store, userdocs)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	session, err := svc.ConnectInMemoryClient(ctx, "skill-resource-test")
	if err != nil {
		t.Fatalf("ConnectInMemoryClient: %v", err)
	}
	defer func() { _ = session.Close() }()

	listed, err := session.ListResources(ctx, nil)
	if err != nil {
		t.Fatalf("ListResources: %v", err)
	}
	var found *mcp.Resource
	for _, r := range listed.Resources {
		if r.URI == "mill://skill" {
			found = r
		}
	}
	if found == nil {
		t.Fatalf("ListResources did not include mill://skill, got %+v", listed.Resources)
	}
	if found.MIMEType != "text/markdown" {
		t.Errorf("mill://skill MIMEType = %q, want text/markdown", found.MIMEType)
	}

	res, err := session.ReadResource(ctx, &mcp.ReadResourceParams{URI: "mill://skill"})
	if err != nil {
		t.Fatalf("ReadResource(mill://skill): %v", err)
	}
	if len(res.Contents) != 1 || res.Contents[0].Text != "---\nname: working-with-mill\n---\n\nhello\n" {
		t.Errorf("mill://skill content = %+v, want the committed fixture verbatim", res.Contents)
	}
}

// TestMillMCPService_Skill_NoUserdocsWiredErrors: before main.go's
// embedded userdocs FS is injected, mill://skill must fail closed with
// a real error, not panic -- same shape as the other resources' nil
// guards in this package.
func TestMillMCPService_Skill_NoUserdocsWiredErrors(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})
	svc := NewMillMCPService("0.0.0-test", comp, cfg, store, nil)

	if _, err := svc.SkillDocument(); err == nil {
		t.Error("SkillDocument() with no userdocs wired: want an error, got nil")
	}
}

// TestBootstrapRead_FreshAgentAuthorsAndCallsFromSkillAndContractAlone
// is goal 0160's own acceptance predicate, proven mechanically: an
// agent that has read ONLY mill://skill + mill://contract (a) authors
// a minimal valid workflow import purely from the contract's own
// step-type catalog, submits it through the REAL gated import path
// (never a direct Go call into ImportWorkflow), and approves it via
// the approval service exactly as a human would (docs/adr/0032), and
// (b) calls one read tool correctly. The live-LLM version of this same
// check is a manual check named in testing.md's registry -- this proves
// the bootstrap is mechanically SUFFICIENT, not that an actual model
// behaves this way.
func TestBootstrapRead_FreshAgentAuthorsAndCallsFromSkillAndContractAlone(t *testing.T) {
	origWindow := mcpWriteCourtesyWindow
	mcpWriteCourtesyWindow = 150 * time.Millisecond
	t.Cleanup(func() { mcpWriteCourtesyWindow = origWindow })

	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})

	skillMD, err := os.ReadFile(filepath.Join("..", "..", "..", "userdocs", "agents", "skill.md")) // #nosec G304 -- fixed relative path to this repo's own committed doc
	if err != nil {
		t.Fatalf("read committed skill doc: %v", err)
	}
	userdocs := fstest.MapFS{skillDocPath: {Data: skillMD}}

	svc := NewMillMCPService("0.0.0-test", comp, cfg, store, userdocs)
	if err := store.Set(MCPWriteEnabledKey, "true"); err != nil {
		t.Fatalf("enable MCP writes: %v", err)
	}
	// Approval key left unset: required stays the default -- this test
	// exercises the real park-then-approve path, not the relaxed
	// unattended shape millmcpservice_tools_test.go uses.

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	session, err := svc.ConnectInMemoryClient(ctx, "bootstrap-proficiency-test")
	if err != nil {
		t.Fatalf("ConnectInMemoryClient: %v", err)
	}
	defer func() { _ = session.Close() }()

	// --- (1) Read ONLY mill://skill + mill://contract -- the whole
	//     bootstrap this goal ships. ---
	skillRes, err := session.ReadResource(ctx, &mcp.ReadResourceParams{URI: "mill://skill"})
	if err != nil {
		t.Fatalf("ReadResource(mill://skill): %v", err)
	}
	if len(skillRes.Contents) != 1 || !strings.Contains(skillRes.Contents[0].Text, "Reads are free; writes are proposals") {
		t.Fatalf("mill://skill doesn't read back the practice-layer doc")
	}

	contractRes, err := session.ReadResource(ctx, &mcp.ReadResourceParams{URI: "mill://contract"})
	if err != nil {
		t.Fatalf("ReadResource(mill://contract): %v", err)
	}
	var doc contract.ServedDocument
	if err := json.Unmarshal([]byte(contractRes.Contents[0].Text), &doc); err != nil {
		t.Fatalf("mill://contract is not the typed contract document: %v", err)
	}

	// --- (2) Derive a minimal, valid two-step workflow purely from the
	//     contract's own step-type catalog: any trigger that produces
	//     no payload (an "empty start"), plus any capture step -- no
	//     hardcoded step-type IDs, no domain knowledge beyond what the
	//     two resources just handed over. ---
	var triggerID, captureID string
	for _, nt := range doc.StepTypes {
		if triggerID == "" && nt.Kind == composition.KindTrigger && nt.Produces.Kind == composition.PayloadNone {
			triggerID = nt.ID
		}
		if captureID == "" && nt.Kind == composition.KindCapture {
			captureID = nt.ID
		}
	}
	if triggerID == "" || captureID == "" {
		t.Fatalf("contract's step-type catalog has no usable trigger/capture pair (trigger=%q capture=%q)", triggerID, captureID)
	}
	var schema string
	for _, s := range doc.Import.SupportedSchemas {
		if strings.Contains(s, "/workflow/") {
			schema = s
		}
	}
	if schema == "" {
		t.Fatal("contract's import.supportedSchemas names no workflow schema")
	}

	payload, err := json.Marshal(map[string]any{
		"schema":      schema,
		"label":       "Bootstrap proficiency workflow",
		"description": "authored from mill://skill + mill://contract alone",
		"steps": []map[string]any{
			{"ID": "t", "Kind": string(composition.KindTrigger), "StepTypeID": triggerID},
			{"ID": "c", "Kind": string(composition.KindCapture), "StepTypeID": captureID},
		},
		"edges": []map[string]any{
			{"ID": "e1", "Source": "t", "Target": "c"},
		},
	})
	if err != nil {
		t.Fatalf("marshal authored payload: %v", err)
	}

	// --- (3) Submit through the REAL gated import path, exactly the
	//     way an external agent host would call the tool. ---
	type callOutcome struct {
		res *mcp.CallToolResult
		err error
	}
	done := make(chan callOutcome, 1)
	go func() {
		res, callErr := session.CallTool(ctx, &mcp.CallToolParams{
			Name: "import_workflow", Arguments: map[string]any{"json": string(payload)},
		})
		done <- callOutcome{res, callErr}
	}()

	var pendingID string
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if pending := svc.PendingMCPWrites(); len(pending) == 1 {
			pendingID = pending[0].ID
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if pendingID == "" {
		t.Fatal("import_workflow never parked as a pending MCP write")
	}

	// --- (4) Approve it via the approval service -- the human, in this
	//     test. ---
	if err := svc.ResolveMCPWrite(pendingID, true); err != nil {
		t.Fatalf("ResolveMCPWrite(approve): %v", err)
	}

	outcome := <-done
	if outcome.err != nil {
		t.Fatalf("CallTool(import_workflow): %v", outcome.err)
	}
	if outcome.res.IsError {
		t.Fatalf("import_workflow errored: %+v", outcome.res.Content)
	}
	var imported struct {
		ID    string `json:"id"`
		Label string `json:"label"`
	}
	if err := json.Unmarshal([]byte(outcome.res.Content[0].(*mcp.TextContent).Text), &imported); err != nil {
		t.Fatalf("import_workflow result is not the typed {id,label} JSON: %v", err)
	}
	if imported.ID == "" || imported.Label != "Bootstrap proficiency workflow" {
		t.Fatalf("import_workflow result = %+v, want the authored workflow", imported)
	}
	found := false
	for _, wf := range comp.Workflows() {
		if wf.ID == imported.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("the approved import never actually created the workflow")
	}

	// --- (5) Call one read tool correctly: list_step_types, the live
	//     twin of the catalog the contract document already served. ---
	toolRes, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "list_step_types", Arguments: map[string]any{}})
	if err != nil {
		t.Fatalf("CallTool(list_step_types): %v", err)
	}
	if toolRes.IsError {
		t.Fatalf("list_step_types errored: %+v", toolRes.Content)
	}
	if !strings.Contains(toolRes.Content[0].(*mcp.TextContent).Text, triggerID) {
		t.Errorf("list_step_types doesn't mention %q, the trigger step type the authored workflow just used", triggerID)
	}
}
