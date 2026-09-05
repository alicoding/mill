package configuresvc

import (
	"testing"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

func TestCreateAIProvider_ValidatesAndPersists(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	p, err := cfg.CreateAIProvider("My Provider", aiprovider.KindOpenAICompat, "http://localhost:11434", "llama3.2", "")
	if err != nil {
		t.Fatalf("CreateAIProvider returned error: %v", err)
	}
	if p.ID == "" {
		t.Error("CreateAIProvider left ID empty, want a generated ID")
	}
	got := cfg.AIProviders()
	var found bool
	for _, entry := range got {
		if entry.ID == p.ID {
			found = true
		}
	}
	if !found {
		t.Errorf("AIProviders() = %+v, want the created provider present", got)
	}
}

func TestCreateAIProvider_InvalidRejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.CreateAIProvider("", aiprovider.KindOpenAICompat, "http://localhost:11434", "llama3.2", ""); err == nil {
		t.Fatal("CreateAIProvider with an empty label returned nil error, want an error")
	}
	if _, err := cfg.CreateAIProvider("x", aiprovider.KindOpenAICompat, "", "llama3.2", ""); err == nil {
		t.Fatal("CreateAIProvider (openai-compatible) with an empty base URL returned nil error, want an error")
	}
}

func TestUpdateAIProvider_UnknownID_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.UpdateAIProvider("does-not-exist", "New label", aiprovider.KindOpenAICompat, "http://localhost:11434", "llama3.2", ""); err == nil {
		t.Fatal("UpdateAIProvider with an unknown id returned nil error, want an error")
	}
}

// A deleted provider takes its KEY REFERENCE with it and leaves the
// stored entry alone (goal 0306): deleting the last thing pointing at
// a credential is not consent to destroy the credential.
func TestDeleteAIProvider_RemovesItAndLeavesTheStoredKey(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	secrets := secretStoreOf(t, cfg)
	ref := secrets.Put("My Provider: API key", "sk-ant-test")
	p, err := cfg.CreateAIProvider("My Provider", aiprovider.KindAnthropic, "", "claude-sonnet-4-5", ref)
	if err != nil {
		t.Fatalf("CreateAIProvider returned error: %v", err)
	}
	if err := cfg.DeleteAIProvider(p.ID); err != nil {
		t.Fatalf("DeleteAIProvider returned error: %v", err)
	}
	for _, entry := range cfg.AIProviders() {
		if entry.ID == p.ID {
			t.Error("AIProviders() still returns the deleted provider")
		}
	}
	if _, err := cfg.resolveAIProvider(p.ID); err == nil {
		t.Error("resolveAIProvider found a provider after it was deleted")
	}
	if secrets.Len() != 1 {
		t.Errorf("secret store holds %d entries after deleting the provider that named one, want the entry left alone", secrets.Len())
	}
}

func TestResolveAIProvider_NoSecretConfigured_EmptyAPIKey(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	p, err := cfg.CreateAIProvider("Local Ollama", aiprovider.KindOpenAICompat, "http://localhost:11434", "llama3.2", "")
	if err != nil {
		t.Fatalf("CreateAIProvider returned error: %v", err)
	}
	rp, err := cfg.resolveAIProvider(p.ID)
	if err != nil {
		t.Fatalf("resolveAIProvider returned error: %v", err)
	}
	if rp.APIKey != "" {
		t.Errorf("APIKey = %q, want empty for a provider with no secret set", rp.APIKey)
	}
	if rp.BaseURL != "http://localhost:11434" || rp.Model != "llama3.2" {
		t.Errorf("resolveAIProvider = %+v, unexpected BaseURL/Model", rp)
	}
}

// A provider's key is resolved from the entry it NAMES, and clearing
// the reference stops resolving one -- the entry itself is untouched.
func TestResolveAIProvider_KeyResolvesThroughItsReference(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	ref := secretStoreOf(t, cfg).Put("OpenAI: API key", "sk-test-123")
	p, err := cfg.CreateAIProvider("OpenAI", aiprovider.KindOpenAICompat, "https://api.openai.com", "gpt-4o-mini", ref)
	if err != nil {
		t.Fatalf("CreateAIProvider returned error: %v", err)
	}
	rp, err := cfg.resolveAIProvider(p.ID)
	if err != nil {
		t.Fatalf("resolveAIProvider returned error: %v", err)
	}
	if rp.APIKey != "sk-test-123" {
		t.Errorf("APIKey = %q, want the value of the entry the provider names", rp.APIKey)
	}

	if _, err := cfg.UpdateAIProvider(p.ID, p.Label, p.Kind, p.BaseURL, p.Model, ""); err != nil {
		t.Fatalf("UpdateAIProvider clearing the key reference: %v", err)
	}
	rp2, err := cfg.resolveAIProvider(p.ID)
	if err != nil {
		t.Fatalf("resolveAIProvider returned error: %v", err)
	}
	if rp2.APIKey != "" {
		t.Errorf("APIKey = %q after clearing the reference, want empty", rp2.APIKey)
	}
}

// A reference naming an entry the store does not hold is an error the
// reader can act on, never a silently empty credential.
func TestResolveAIProvider_ReferenceToAMissingEntry_Errors(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	p, err := cfg.CreateAIProvider("Gone", aiprovider.KindOpenAICompat, "https://api.example.com", "m", "vault:no-such-entry")
	if err != nil {
		t.Fatalf("CreateAIProvider returned error: %v", err)
	}
	if _, err := cfg.resolveAIProvider(p.ID); err == nil {
		t.Fatal("resolveAIProvider with a reference to a missing entry returned nil error, want an error")
	}
}

func TestResolveAIProvider_BlankAnthropicBaseURLDefaultsToRealHost(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	p, err := cfg.CreateAIProvider("Claude", aiprovider.KindAnthropic, "", "claude-sonnet-4-5", "")
	if err != nil {
		t.Fatalf("CreateAIProvider returned error: %v", err)
	}
	rp, err := cfg.resolveAIProvider(p.ID)
	if err != nil {
		t.Fatalf("resolveAIProvider returned error: %v", err)
	}
	if rp.BaseURL != aiprovider.DefaultAnthropicBaseURL {
		t.Errorf("BaseURL = %q, want %q", rp.BaseURL, aiprovider.DefaultAnthropicBaseURL)
	}
}

func TestResolveAIProvider_UnknownID_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.resolveAIProvider("does-not-exist"); err == nil {
		t.Fatal("resolveAIProvider with an unknown id returned nil error, want an error")
	}
}

// TestSeededAIProvider_PresentOnFreshInstall constructs ConfigureService
// directly (not via newTestConfigureService, which deliberately clears
// seeded state for CRUD-test isolation -- see that helper's own doc
// comment) so this test actually observes reconcileBuiltInAIProviders'
// real effect on a genuinely fresh store.
func TestSeededAIProvider_PresentOnFreshInstall(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := NewConfigureService(store, comp, credential.New())
	var found bool
	for _, p := range cfg.AIProviders() {
		if p.ID == aiprovider.ExampleLocalOllamaID {
			found = true
		}
	}
	if !found {
		t.Error("a fresh ConfigureService has no seeded AI provider -- reconcileBuiltInAIProviders should have inserted one")
	}
}

// TestExportImportAIProvider_FreshImportNeverCarriesASecret covers
// ADR-0036 decision 3's create paths (no id, and an id unknown here):
// an export carries the provider's key REFERENCE, never the key, so
// the value itself never reaches the wire even when the entry it names
// exists locally.
func TestExportImportAIProvider_FreshImportNeverCarriesASecret(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	ref := secretStoreOf(t, cfg).Put("BYO endpoint: API key", "should-never-export")
	p, err := cfg.CreateAIProvider("BYO endpoint", aiprovider.KindOpenAICompat, "http://localhost:1234", "custom-model", ref)
	if err != nil {
		t.Fatalf("CreateAIProvider returned error: %v", err)
	}

	data, err := cfg.ExportAIProvider(p.ID)
	if err != nil {
		t.Fatalf("ExportAIProvider returned error: %v", err)
	}
	if got := data; contains(got, "should-never-export") {
		t.Fatalf("ExportAIProvider leaked the secret into its output: %s", got)
	}

	// Strip the id so this exercises the fresh-create path, not the
	// update-in-place path a matching id would take (that path's own
	// secret-preservation behavior is TestExportImportAIProvider_
	// UpdateInPlace_PreservesTheExistingSecret, below).
	fresh := stripIDField(t, data)

	imported, err := cfg.ImportAIProvider(fresh)
	if err != nil {
		t.Fatalf("ImportAIProvider returned error: %v", err)
	}
	if imported.ID == p.ID {
		t.Error("ImportAIProvider of an id-less payload reused the original ID -- should mint a fresh one")
	}
	if imported.Label != p.Label || imported.BaseURL != p.BaseURL || imported.Model != p.Model {
		t.Errorf("imported provider %+v doesn't match the original's content", imported)
	}
	if rp, err := cfg.resolveAIProvider(imported.ID); err != nil || rp.APIKey != "should-never-export" {
		t.Errorf("imported provider resolves APIKey=%q (err=%v) -- the reference travelled and resolves against this device's own store", rp.APIKey, err)
	}
}

// TestExportImportAIProvider_UpdateInPlace_PreservesTheExistingSecret
// covers decision 3's third case: an id matching a local provider
// updates it in place, and the round trip preserves which entry its
// key comes from -- re-importing a provider's config (e.g. after
// editing it on another machine) must never silently unname its
// credential.
func TestExportImportAIProvider_UpdateInPlace_PreservesTheExistingSecret(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	ref := secretStoreOf(t, cfg).Put("BYO endpoint: API key", "keep-me")
	p, err := cfg.CreateAIProvider("BYO endpoint", aiprovider.KindOpenAICompat, "http://localhost:1234", "custom-model", ref)
	if err != nil {
		t.Fatalf("CreateAIProvider returned error: %v", err)
	}

	data, err := cfg.ExportAIProvider(p.ID)
	if err != nil {
		t.Fatalf("ExportAIProvider returned error: %v", err)
	}

	imported, err := cfg.ImportAIProvider(data)
	if err != nil {
		t.Fatalf("ImportAIProvider returned error: %v", err)
	}
	if imported.ID != p.ID {
		t.Errorf("ImportAIProvider.ID = %q, want the same id %q (update in place)", imported.ID, p.ID)
	}
	if rp, err := cfg.resolveAIProvider(imported.ID); err != nil || rp.APIKey != "keep-me" {
		t.Errorf("resolveAIProvider after update: APIKey=%q, err=%v, want %q preserved", rp.APIKey, err, "keep-me")
	}
}

func contains(s, substr string) bool {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
