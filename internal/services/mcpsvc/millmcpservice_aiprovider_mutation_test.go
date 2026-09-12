package mcpsvc

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/contract"
	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestAIProviderMCPTools_RegistrationUsesExistingReadWritePolicy(t *testing.T) {
	tools, err := BuiltInTools(servicetest.NewFakeStore())
	if err != nil {
		t.Fatalf("BuiltInTools: %v", err)
	}
	wantRead := map[string]bool{
		"export_aiprovider":            true,
		"get_aiprovider_change_impact": true,
		"preview_aiprovider_import":    true,
	}
	wantWrite := map[string]bool{
		"import_aiprovider":       true,
		"apply_aiprovider_import": true,
	}
	for _, tool := range tools {
		if wantRead[tool.Name] {
			wantRead[tool.Name] = false
			if tool.Annotations == nil || !tool.Annotations.ReadOnlyHint {
				t.Errorf("%s annotations = %+v, want read-only", tool.Name, tool.Annotations)
			}
		}
		if wantWrite[tool.Name] {
			wantWrite[tool.Name] = false
			if tool.Annotations == nil || tool.Annotations.DestructiveHint == nil || !*tool.Annotations.DestructiveHint {
				t.Errorf("%s annotations = %+v, want destructive mixed mutation", tool.Name, tool.Annotations)
			}
		}
	}
	for name, missing := range wantRead {
		if missing {
			t.Errorf("missing read tool %q", name)
		}
	}
	for name, missing := range wantWrite {
		if missing {
			t.Errorf("missing write tool %q", name)
		}
	}
}

func TestApplyAIProviderImportMCP_ParkedRevisionExpiresBeforeApproval(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})
	configuresvc.SetAIProviderMutationCoordinator(
		cfg,
		func(mutate func(assertUnused func(id string) error) error) error {
			return mutate(func(string) error { return nil })
		},
		func(id string, revision func() string) aiprovider.ChangeImpact {
			return aiprovider.ChangeImpact{
				ProviderID: id, ConfigRevision: revision(), MutationAllowed: true,
			}
		},
	)
	provider, err := cfg.CreateAIProvider("Before", aiprovider.KindAnthropic, "", "before-model", "")
	if err != nil {
		t.Fatalf("CreateAIProvider: %v", err)
	}
	dataBytes, err := json.Marshal(map[string]any{
		"schema": contract.SchemaID("aiprovider"), "id": provider.ID,
		"label": provider.Label, "kind": provider.Kind, "baseURL": provider.BaseURL,
		"model": "imported-model", "keyRef": provider.KeyRef,
	})
	if err != nil {
		t.Fatalf("marshal import: %v", err)
	}
	data := string(dataBytes)
	preview, err := cfg.PreviewAIProviderImport(data)
	if err != nil {
		t.Fatalf("PreviewAIProviderImport: %v", err)
	}

	m := NewMillMCPService("0.0.0-test", comp, cfg, store, nil)
	argsJSON, err := marshalArgs(applyAIProviderImportArgs{
		JSON: data, ExpectedRevision: preview.ExpectedRevision,
	})
	if err != nil {
		t.Fatalf("marshalArgs: %v", err)
	}
	done := make(chan struct {
		result *mcp.CallToolResult
		err    error
	}, 1)
	go func() {
		result, gateErr := m.gateWrite(
			"apply_aiprovider_import",
			"An MCP client wants to apply a reviewed AI provider import",
			argsJSON,
		)
		done <- struct {
			result *mcp.CallToolResult
			err    error
		}{result: result, err: gateErr}
	}()

	var pendingID string
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if pending := m.PendingMCPWrites(); len(pending) == 1 {
			pendingID = pending[0].ID
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if pendingID == "" {
		t.Fatal("apply_aiprovider_import did not park")
	}
	if _, err := cfg.UpdateAIProvider(
		provider.ID, "Changed while parked", provider.Kind, provider.BaseURL, provider.Model, provider.KeyRef,
	); err != nil {
		t.Fatalf("UpdateAIProvider while parked: %v", err)
	}
	if err := m.ResolveMCPWrite(pendingID, true); err != nil {
		t.Fatalf("ResolveMCPWrite: %v", err)
	}
	var out struct {
		result *mcp.CallToolResult
		err    error
	}
	select {
	case out = <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for approved AI provider import")
	}
	if out.err == nil || !strings.Contains(out.err.Error(), "changed after the import preview") {
		t.Fatalf("parked apply error = %v, want stale-preview refusal", out.err)
	}
	for _, got := range cfg.AIProviders() {
		if got.ID == provider.ID {
			if got.Label != "Changed while parked" || got.Model != "before-model" {
				t.Errorf("provider after stale approval = label %q model %q", got.Label, got.Model)
			}
			return
		}
	}
	t.Fatalf("provider %q disappeared", provider.ID)
}
