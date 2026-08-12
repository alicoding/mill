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
	p, err := cfg.CreateAIProvider("My Provider", aiprovider.KindOpenAICompat, "http://localhost:11434", "llama3.2")
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
	if _, err := cfg.CreateAIProvider("", aiprovider.KindOpenAICompat, "http://localhost:11434", "llama3.2"); err == nil {
		t.Fatal("CreateAIProvider with an empty label returned nil error, want an error")
	}
	if _, err := cfg.CreateAIProvider("x", aiprovider.KindOpenAICompat, "", "llama3.2"); err == nil {
		t.Fatal("CreateAIProvider (openai-compatible) with an empty base URL returned nil error, want an error")
	}
}

func TestUpdateAIProvider_UnknownID_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.UpdateAIProvider("does-not-exist", "New label", aiprovider.KindOpenAICompat, "http://localhost:11434", "llama3.2"); err == nil {
		t.Fatal("UpdateAIProvider with an unknown id returned nil error, want an error")
	}
}

func TestDeleteAIProvider_RemovesItAndItsSecret(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	p, err := cfg.CreateAIProvider("My Provider", aiprovider.KindAnthropic, "", "claude-sonnet-4-5")
	if err != nil {
		t.Fatalf("CreateAIProvider returned error: %v", err)
	}
	if err := cfg.SetAIProviderSecret(p.ID, "sk-ant-test"); err != nil {
		t.Fatalf("SetAIProviderSecret: %v", err)
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
}

func TestResolveAIProvider_NoSecretConfigured_EmptyAPIKey(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	p, err := cfg.CreateAIProvider("Local Ollama", aiprovider.KindOpenAICompat, "http://localhost:11434", "llama3.2")
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

func TestResolveAIProvider_SecretRoundTrips(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	p, err := cfg.CreateAIProvider("OpenAI", aiprovider.KindOpenAICompat, "https://api.openai.com", "gpt-4o-mini")
	if err != nil {
		t.Fatalf("CreateAIProvider returned error: %v", err)
	}
	if err := cfg.SetAIProviderSecret(p.ID, "sk-test-123"); err != nil {
		t.Fatalf("SetAIProviderSecret: %v", err)
	}
	rp, err := cfg.resolveAIProvider(p.ID)
	if err != nil {
		t.Fatalf("resolveAIProvider returned error: %v", err)
	}
	if rp.APIKey != "sk-test-123" {
		t.Errorf("APIKey = %q, want the secret just set", rp.APIKey)
	}

	if err := cfg.DeleteAIProviderSecret(p.ID); err != nil {
		t.Fatalf("DeleteAIProviderSecret: %v", err)
	}
	rp2, err := cfg.resolveAIProvider(p.ID)
	if err != nil {
		t.Fatalf("resolveAIProvider returned error: %v", err)
	}
	if rp2.APIKey != "" {
		t.Errorf("APIKey = %q after DeleteAIProviderSecret, want empty", rp2.APIKey)
	}
}

func TestResolveAIProvider_BlankAnthropicBaseURLDefaultsToRealHost(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	p, err := cfg.CreateAIProvider("Claude", aiprovider.KindAnthropic, "", "claude-sonnet-4-5")
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

func TestExportImportAIProvider_RoundTripsWithoutSecret(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	p, err := cfg.CreateAIProvider("BYO endpoint", aiprovider.KindOpenAICompat, "http://localhost:1234", "custom-model")
	if err != nil {
		t.Fatalf("CreateAIProvider returned error: %v", err)
	}
	if err := cfg.SetAIProviderSecret(p.ID, "should-never-export"); err != nil {
		t.Fatalf("SetAIProviderSecret: %v", err)
	}

	data, err := cfg.ExportAIProvider(p.ID)
	if err != nil {
		t.Fatalf("ExportAIProvider returned error: %v", err)
	}
	if got := data; contains(got, "should-never-export") {
		t.Fatalf("ExportAIProvider leaked the secret into its output: %s", got)
	}

	imported, err := cfg.ImportAIProvider(data)
	if err != nil {
		t.Fatalf("ImportAIProvider returned error: %v", err)
	}
	if imported.ID == p.ID {
		t.Error("ImportAIProvider reused the original ID -- import must always mint a new entity (ADR-0013's Duplicate precedent)")
	}
	if imported.Label != p.Label || imported.BaseURL != p.BaseURL || imported.Model != p.Model {
		t.Errorf("imported provider %+v doesn't match the original's content", imported)
	}
	if rp, err := cfg.resolveAIProvider(imported.ID); err != nil || rp.APIKey != "" {
		t.Errorf("imported provider has a non-empty secret (APIKey=%q, err=%v), want none set", rp.APIKey, err)
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
