package configuresvc

import (
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/declaredsteptype"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

func newDeclaredStepTypeHarness(t *testing.T) *ConfigureService {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	return NewConfigureService(store, comp, credential.New())
}

// TestConfigureService_FreshInstall_SeedsBuiltInDeclaredStepTypes
// mirrors TestConfigureService_FreshInstall_SeedsBuiltInDecisions
// (goal 0054 slice A).
func TestConfigureService_FreshInstall_SeedsBuiltInDeclaredStepTypes(t *testing.T) {
	cfg := newDeclaredStepTypeHarness(t)

	got := cfg.DeclaredStepTypes()
	want := declaredsteptype.BuiltIn()
	if len(got) != len(want) {
		t.Fatalf("DeclaredStepTypes() on a fresh install = %d entries, want %d (declaredsteptype.BuiltIn())", len(got), len(want))
	}
	seen := map[string]bool{}
	for _, d := range got {
		seen[d.ID] = true
	}
	for _, d := range want {
		if !seen[d.ID] {
			t.Errorf("fresh-install DeclaredStepTypes() missing built-in %q", d.ID)
		}
	}
}

// A deleted built-in DeclaredStepType is tombstoned, so a later top-up
// call never resurrects it -- same discipline every sibling entity's
// own reconcile already has.
func TestConfigureService_DeletedBuiltInDeclaredStepType_NotResurrectedByTopUp(t *testing.T) {
	cfg := newDeclaredStepTypeHarness(t)
	if err := cfg.DeleteDeclaredStepType(declaredsteptype.ExampleCheckHTTPBinID); err != nil {
		t.Fatalf("DeleteDeclaredStepType: %v", err)
	}
	cfg.reconcileBuiltInDeclaredStepTypes()
	for _, d := range cfg.DeclaredStepTypes() {
		if d.ID == declaredsteptype.ExampleCheckHTTPBinID {
			t.Fatal("reconcileBuiltInDeclaredStepTypes resurrected a deliberately deleted built-in")
		}
	}
}

func TestCreateDeclaredStepType_InvalidEngine_Rejected(t *testing.T) {
	cfg := newDeclaredStepTypeHarness(t)
	if _, err := cfg.CreateDeclaredStepType("Bad", "", declaredsteptype.GroupActions, declaredsteptype.Engine("not-real"), "", "", "", "", nil, nil); err == nil {
		t.Fatal("CreateDeclaredStepType with an invalid engine returned nil error, want an error")
	}
}

func TestCreateDeclaredStepType_HTTPEngine_ThenAppearsInNodeTypesAsDeclared(t *testing.T) {
	cfg := newDeclaredStepTypeHarness(t)
	d, err := cfg.CreateDeclaredStepType("My integration step", "desc", declaredsteptype.GroupActions, declaredsteptype.EngineHTTP, "example-none-httpbin", "", "", "", nil, nil)
	if err != nil {
		t.Fatalf("CreateDeclaredStepType: %v", err)
	}

	var found *composition.NodeType
	for _, nt := range composition.NodeTypes() {
		if nt.ID == d.ID {
			nt := nt
			found = &nt
		}
	}
	if found == nil {
		t.Fatalf("composition.NodeTypes() has no entry for the newly-created declared step type %q", d.ID)
	}
	if !found.Declared {
		t.Errorf("synthesized NodeType %+v has Declared=false, want true", found)
	}
	// requestId is the engine's own binding field -- always hidden
	// (configuredeclaredsteptype.go's declaredStepBindings), so it must
	// never appear as an author-editable ConfigField.
	for _, f := range found.ConfigFields {
		if f.Key == "requestId" {
			t.Errorf("synthesized ConfigFields still exposes the pinned/hidden binding field %q", f.Key)
		}
	}
}

func TestUpdateDeclaredStepType_LatchesModifiedOnBuiltIn(t *testing.T) {
	cfg := newDeclaredStepTypeHarness(t)
	updated, err := cfg.UpdateDeclaredStepType(declaredsteptype.ExampleCheckHTTPBinID, "Renamed", "d", declaredsteptype.GroupActions, declaredsteptype.EngineHTTP, "example-none-httpbin", "", "", "", nil, nil)
	if err != nil {
		t.Fatalf("UpdateDeclaredStepType: %v", err)
	}
	if !updated.Seed.Modified {
		t.Error("UpdateDeclaredStepType on a built-in did not latch Seed.Modified")
	}
}

func TestDeleteDeclaredStepType_Unknown_Errors(t *testing.T) {
	cfg := newDeclaredStepTypeHarness(t)
	if err := cfg.DeleteDeclaredStepType("does-not-exist"); err == nil {
		t.Fatal("DeleteDeclaredStepType(unknown id) returned nil error, want an error")
	}
}

func TestExportImportDeclaredStepType_RoundTrips(t *testing.T) {
	cfg := newDeclaredStepTypeHarness(t)
	created, err := cfg.CreateDeclaredStepType("Roundtrip", "desc", declaredsteptype.GroupData, declaredsteptype.EngineWorkflow, "", "", "", "example-child-workflow", map[string]string{"idempotencyKey": "x"}, []string{"version"})
	if err != nil {
		t.Fatalf("CreateDeclaredStepType: %v", err)
	}

	exported, err := cfg.ExportDeclaredStepType(created.ID)
	if err != nil {
		t.Fatalf("ExportDeclaredStepType: %v", err)
	}
	if !strings.Contains(exported, `"id": "`+created.ID+`"`) {
		t.Fatalf("export omits id: %s", exported)
	}
	if err := cfg.DeleteDeclaredStepType(created.ID); err != nil {
		t.Fatalf("DeleteDeclaredStepType: %v", err)
	}

	imported, err := cfg.ImportDeclaredStepType(exported)
	if err != nil {
		t.Fatalf("ImportDeclaredStepType: %v", err)
	}
	// ADR-0036 decision 3: id present, unknown locally -> create
	// preserving the id.
	if imported.ID != created.ID {
		t.Errorf("ImportDeclaredStepType id = %q, want the preserved original id %q", imported.ID, created.ID)
	}
	if imported.WorkflowID != "example-child-workflow" || imported.Engine != declaredsteptype.EngineWorkflow {
		t.Errorf("ImportDeclaredStepType = %+v, want the original engine/binding round-tripped", imported)
	}

	// Re-importing the same document a second time now finds a known
	// local id -> updates in place rather than creating a duplicate.
	if _, err := cfg.ImportDeclaredStepType(exported); err != nil {
		t.Fatalf("second ImportDeclaredStepType (update path): %v", err)
	}
	all := cfg.DeclaredStepTypes()
	count := 0
	for _, d := range all {
		if d.ID == created.ID {
			count++
		}
	}
	if count != 1 {
		t.Errorf("declared step type %q appears %d times after a second import, want exactly 1 (update, not a duplicate create)", created.ID, count)
	}
}

// TestDataEvent_DeclaredStepTypeMutations proves goal 0017's P0-2 for
// declared step types -- "steptype" is a NEW entity string on the wire
// (goal 0054 slice A), same captureEmits pattern every sibling entity's
// own dataevent test already uses.
func TestDataEvent_DeclaredStepTypeMutations(t *testing.T) {
	cfg := newDeclaredStepTypeHarness(t)

	got := captureEmits(t)
	d, err := cfg.CreateDeclaredStepType("Emit test step", "", declaredsteptype.GroupActions, declaredsteptype.EngineHTTP, "example-none-httpbin", "", "", "", nil, nil)
	if err != nil {
		t.Fatalf("CreateDeclaredStepType: %v", err)
	}
	assertEmitted(t, *got, "steptype", d.ID)

	got = captureEmits(t)
	d, err = cfg.UpdateDeclaredStepType(d.ID, "Emit test step (edited)", "", declaredsteptype.GroupActions, declaredsteptype.EngineHTTP, "example-none-httpbin", "", "", "", nil, nil)
	if err != nil {
		t.Fatalf("UpdateDeclaredStepType: %v", err)
	}
	assertEmitted(t, *got, "steptype", d.ID)

	got = captureEmits(t)
	if err := cfg.DeleteDeclaredStepType(d.ID); err != nil {
		t.Fatalf("DeleteDeclaredStepType: %v", err)
	}
	assertEmitted(t, *got, "steptype", d.ID)
}
