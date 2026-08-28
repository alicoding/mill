package mcpsvc

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// TestMigrateLegacyPendingWrites_UpgradePath_PendingWriteSurvivesAndResolves
// proves the upgrade path (docs/adr/0047 §5.4's follow-up): a settings
// file written by a pre-migration Mill still has its pending write
// under the OLD "mcp-pending-writes" key, in the OLD MCPWriteRecord
// shape. MigrateLegacyPendingWrites converts it BEFORE
// guardrailsvc.NewGuardrailService constructs its own durable store
// (main.go's own ordering, mirrored here) so a user's parked write
// survives the upgrade -- listed via PendingMCPWrites and resolvable
// exactly like a write parked after the upgrade.
func TestMigrateLegacyPendingWrites_UpgradePath_PendingWriteSurvivesAndResolves(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})

	wf, err := comp.CreateWorkflow("Migration test workflow", "",
		[]composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}, {ID: "c", NodeTypeID: "capture-clipboard-html"}},
		[]composition.Edge{{ID: "e1", Source: "t", Target: "c"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	exported, err := comp.ExportWorkflow(wf.ID)
	if err != nil {
		t.Fatalf("ExportWorkflow: %v", err)
	}
	before := len(comp.Workflows())
	argsJSON, err := marshalArgs(importToolArgs{JSON: stripJSONIDField(t, exported)})
	if err != nil {
		t.Fatalf("marshalArgs: %v", err)
	}

	// Seed the OLD key, in the OLD (pre-migration) MCPWriteRecord JSON
	// shape -- exactly what a pre-migration Mill's settings.json holds.
	legacyBlob := map[string]map[string]any{
		"legacy-write-1": {
			"id": "legacy-write-1", "description": "a pre-migration pending import",
			"toolName": "import_workflow", "argsJson": argsJSON,
			"createdAt": time.Now().Add(-time.Minute), "status": "pending",
		},
	}
	raw, err := json.Marshal(legacyBlob)
	if err != nil {
		t.Fatalf("marshal legacy blob: %v", err)
	}
	if err := store.Set(legacyMCPPendingWritesKey, string(raw)); err != nil {
		t.Fatalf("seed legacy key: %v", err)
	}

	// The migration must run BEFORE any PendingActionStore is
	// constructed against store -- mirrors main.go's own ordering
	// (MigrateLegacyPendingWrites, then guardrailsvc.NewGuardrailService).
	if err := MigrateLegacyPendingWrites(store); err != nil {
		t.Fatalf("MigrateLegacyPendingWrites: %v", err)
	}
	if raw, ok := store.Get(legacyMCPPendingWritesKey).(string); !ok || raw != "" {
		t.Errorf("legacy key after migration = %q, want cleared", raw)
	}

	guard := guardrailsvc.NewGuardrailService(store, comp)
	m := NewMillMCPService("0.0.0-test", comp, cfg, store, nil)
	m.SetGuardrailService(guard)
	if err := store.Set(MCPWriteEnabledKey, "true"); err != nil {
		t.Fatalf("set write key: %v", err)
	}

	pending := m.PendingMCPWrites()
	if len(pending) != 1 || pending[0].ID != "legacy-write-1" {
		t.Fatalf("PendingMCPWrites() after migration = %+v, want the migrated write listed under its original id", pending)
	}
	if pending[0].Description != "a pre-migration pending import" {
		t.Errorf("Description = %q, want the legacy field carried through", pending[0].Description)
	}

	if err := m.ResolveMCPWrite("legacy-write-1", true); err != nil {
		t.Fatalf("ResolveMCPWrite on a migrated write: %v", err)
	}
	if got := len(comp.Workflows()); got != before+1 {
		t.Errorf("workflow count after resolving a migrated write = %d, want %d -- the migrated ToolName/ArgsJSON payload must re-dispatch correctly", got, before+1)
	}
	if pending := m.PendingMCPWrites(); len(pending) != 0 {
		t.Errorf("PendingMCPWrites() after resolving the migrated write = %+v, want empty", pending)
	}
}

// TestMigrateLegacyPendingWrites_NoLegacyKey_NoOp proves migration is
// silently harmless on a store that never had the old key -- every
// fresh install and every already-migrated store.
func TestMigrateLegacyPendingWrites_NoLegacyKey_NoOp(t *testing.T) {
	store := servicetest.NewFakeStore()
	if err := MigrateLegacyPendingWrites(store); err != nil {
		t.Fatalf("MigrateLegacyPendingWrites on a store with no legacy key: %v", err)
	}
}
