package configuresvc

import (
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/alicoding/mill/internal/contract"
	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/usererror"
)

func TestPreviewAIProviderImport_ValidatesWithoutContactingEndpoint(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	installAIProviderReviewCoordinator(cfg, nil)

	data := aiProviderImportJSON(t, exportedAIProvider{
		Label:   "Private endpoint",
		Kind:    aiprovider.KindOpenAICompat,
		BaseURL: strings.Join([]string{"https://reader", "secret@example.invalid/v1?token=also-secret#private"}, ":"),
		Model:   "model-under-test",
		KeyRef:  "provider-key",
	})
	preview, err := cfg.PreviewAIProviderImport(data)
	if err != nil {
		t.Fatalf("PreviewAIProviderImport returned error: %v", err)
	}

	if preview.ProviderID != "" || preview.Mode != aiprovider.ImportModeCreate {
		t.Fatalf("preview identity = (%q, %q), want a fresh create", preview.ProviderID, preview.Mode)
	}
	if preview.ExpectedRevision != aiprovider.RevisionAbsent {
		t.Errorf("ExpectedRevision = %q, want %q", preview.ExpectedRevision, aiprovider.RevisionAbsent)
	}
	if preview.Proposed.Endpoint != "https://example.invalid/v1" {
		t.Errorf("safe endpoint = %q, want credentials, query, and fragment removed", preview.Proposed.Endpoint)
	}
	encoded, err := json.Marshal(preview)
	if err != nil {
		t.Fatalf("marshal preview: %v", err)
	}
	for _, secret := range []string{"secret", "also-secret"} {
		if strings.Contains(string(encoded), secret) {
			t.Errorf("preview JSON exposed %q: %s", secret, encoded)
		}
	}
}

func TestPreviewAIProviderImport_RejectsMalformedAndInvalidProvider(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	installAIProviderReviewCoordinator(cfg, nil)

	for name, data := range map[string]string{
		"malformed JSON": `{`,
		"wrong schema":   `{"schema":"https://mill.invalid/schemas/request.json","label":"x","kind":"anthropic","model":"m"}`,
		"invalid provider": aiProviderImportJSON(t, exportedAIProvider{
			Label: "Missing model", Kind: aiprovider.KindAnthropic,
		}),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := cfg.PreviewAIProviderImport(data); err == nil {
				t.Fatal("PreviewAIProviderImport returned nil error")
			}
		})
	}
}

func TestPreviewAIProviderImport_ExistingProviderIsPassiveAndReviewable(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	installAIProviderReviewCoordinator(cfg, nil)
	existing, err := cfg.createAIProviderUncoordinated(
		"provider-under-test", "Before", aiprovider.KindAnthropic, "", "before-model", "before-key",
	)
	if err != nil {
		t.Fatalf("create existing provider: %v", err)
	}
	data := aiProviderImportJSON(t, exportedAIProvider{
		ID: existing.ID, Label: "After", Kind: aiprovider.KindAnthropic,
		Model: "after-model", KeyRef: "after-key",
	})

	preview, err := cfg.PreviewAIProviderImport(data)
	if err != nil {
		t.Fatalf("PreviewAIProviderImport returned error: %v", err)
	}
	if preview.Mode != aiprovider.ImportModeReplace || preview.Current == nil {
		t.Fatalf("preview = %+v, want replacement with current projection", preview)
	}
	if preview.Current.Label != "Before" || preview.Proposed.Label != "After" {
		t.Errorf("preview labels = current %q proposed %q, want Before/After", preview.Current.Label, preview.Proposed.Label)
	}
	if preview.ExpectedRevision == "" || preview.ExpectedRevision == aiprovider.RevisionAbsent {
		t.Errorf("ExpectedRevision = %q, want existing configuration revision", preview.ExpectedRevision)
	}
	if got := mustAIProviderByID(t, cfg, existing.ID); got.Model != "before-model" {
		t.Errorf("preview mutated provider model to %q", got.Model)
	}
}

func TestApplyAIProviderImport_RejectsChangedRevision(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	installAIProviderReviewCoordinator(cfg, nil)
	existing, err := cfg.createAIProviderUncoordinated(
		"provider-under-test", "Before", aiprovider.KindAnthropic, "", "before-model", "",
	)
	if err != nil {
		t.Fatalf("create existing provider: %v", err)
	}
	data := aiProviderImportJSON(t, exportedAIProvider{
		ID: existing.ID, Label: "Imported", Kind: aiprovider.KindAnthropic, Model: "imported-model",
	})
	preview, err := cfg.PreviewAIProviderImport(data)
	if err != nil {
		t.Fatalf("preview import: %v", err)
	}
	if _, err := cfg.updateAIProviderUncoordinated(
		existing.ID, "Changed elsewhere", existing.Kind, existing.BaseURL, existing.Model, existing.KeyRef,
	); err != nil {
		t.Fatalf("mutate provider after preview: %v", err)
	}

	_, err = cfg.ApplyAIProviderImport(data, preview.ExpectedRevision)
	assertUserErrorCode(t, err, errAIProviderImportPreviewStale.Code)
	if got := mustAIProviderByID(t, cfg, existing.ID); got.Label != "Changed elsewhere" {
		t.Errorf("stale apply changed provider label to %q", got.Label)
	}
}

func TestApplyAIProviderImport_RejectsAbsentToCreatedRace(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	installAIProviderReviewCoordinator(cfg, nil)
	data := aiProviderImportJSON(t, exportedAIProvider{
		ID: "provider-under-test", Label: "Imported", Kind: aiprovider.KindAnthropic, Model: "imported-model",
	})
	preview, err := cfg.PreviewAIProviderImport(data)
	if err != nil {
		t.Fatalf("preview import: %v", err)
	}
	if preview.ExpectedRevision != aiprovider.RevisionAbsent {
		t.Fatalf("ExpectedRevision = %q, want absent", preview.ExpectedRevision)
	}
	if _, err := cfg.createAIProviderUncoordinated(
		"provider-under-test", "Created elsewhere", aiprovider.KindAnthropic, "", "other-model", "",
	); err != nil {
		t.Fatalf("create provider after preview: %v", err)
	}

	_, err = cfg.ApplyAIProviderImport(data, preview.ExpectedRevision)
	assertUserErrorCode(t, err, errAIProviderImportPreviewStale.Code)
	if got := mustAIProviderByID(t, cfg, "provider-under-test"); got.Label != "Created elsewhere" {
		t.Errorf("stale apply changed provider label to %q", got.Label)
	}
}

func TestApplyAIProviderImport_RechecksRuntimeUse(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	var assertions atomic.Int32
	installAIProviderReviewCoordinator(cfg, func(id string) error {
		assertions.Add(1)
		return usererror.New(
			string(aiprovider.ChangeBlockerProviderInUse),
			"This connection is used by an unfinished run. Wait for it to finish before changing it.",
		)
	})
	existing, err := cfg.createAIProviderUncoordinated(
		"provider-under-test", "Before", aiprovider.KindAnthropic, "", "before-model", "",
	)
	if err != nil {
		t.Fatalf("create existing provider: %v", err)
	}
	data := aiProviderImportJSON(t, exportedAIProvider{
		ID: existing.ID, Label: existing.Label, Kind: existing.Kind, Model: "after-model",
	})
	preview, err := cfg.PreviewAIProviderImport(data)
	if err != nil {
		t.Fatalf("preview import: %v", err)
	}

	_, err = cfg.ApplyAIProviderImport(data, preview.ExpectedRevision)
	assertUserErrorCode(t, err, string(aiprovider.ChangeBlockerProviderInUse))
	if assertions.Load() != 1 {
		t.Errorf("unused assertions = %d, want 1", assertions.Load())
	}
	if got := mustAIProviderByID(t, cfg, existing.ID); got.Model != "before-model" {
		t.Errorf("refused apply changed provider model to %q", got.Model)
	}
}

func TestApplyAIProviderImport_LabelOnlyChangeDoesNotRequireUnused(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	var assertions atomic.Int32
	installAIProviderReviewCoordinator(cfg, func(string) error {
		assertions.Add(1)
		return usererror.New(
			string(aiprovider.ChangeBlockerProviderInUse),
			"This connection is used by an unfinished run. Wait for it to finish before changing it.",
		)
	})
	existing, err := cfg.createAIProviderUncoordinated(
		"provider-under-test", "Before", aiprovider.KindAnthropic, "", "same-model", "same-key",
	)
	if err != nil {
		t.Fatalf("create existing provider: %v", err)
	}
	data := aiProviderImportJSON(t, exportedAIProvider{
		ID: existing.ID, Label: "After", Kind: existing.Kind, Model: existing.Model, KeyRef: existing.KeyRef,
	})
	preview, err := cfg.PreviewAIProviderImport(data)
	if err != nil {
		t.Fatalf("preview import: %v", err)
	}

	applied, err := cfg.ApplyAIProviderImport(data, preview.ExpectedRevision)
	if err != nil {
		t.Fatalf("ApplyAIProviderImport returned error: %v", err)
	}
	if applied.Label != "After" || assertions.Load() != 0 {
		t.Errorf("label-only apply = label %q, assertions %d; want After and 0", applied.Label, assertions.Load())
	}
}

func TestApplyAIProviderImport_FreshCreateMintsID(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	installAIProviderReviewCoordinator(cfg, nil)
	data := aiProviderImportJSON(t, exportedAIProvider{
		Label: "Imported", Kind: aiprovider.KindAnthropic, Model: "model-under-test",
	})
	preview, err := cfg.PreviewAIProviderImport(data)
	if err != nil {
		t.Fatalf("preview import: %v", err)
	}

	applied, err := cfg.ApplyAIProviderImport(data, preview.ExpectedRevision)
	if err != nil {
		t.Fatalf("ApplyAIProviderImport returned error: %v", err)
	}
	if applied.ID == "" {
		t.Fatal("fresh apply returned an empty ID")
	}
	if got := mustAIProviderByID(t, cfg, applied.ID); got.Label != "Imported" {
		t.Errorf("persisted provider label = %q, want Imported", got.Label)
	}
}

func TestImportAIProvider_CompatibilityPathRechecksRuntimeUse(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	installAIProviderReviewCoordinator(cfg, func(string) error {
		return usererror.New(
			string(aiprovider.ChangeBlockerProviderInUse),
			"This connection is used by an unfinished run. Wait for it to finish before changing it.",
		)
	})
	existing, err := cfg.createAIProviderUncoordinated(
		"provider-under-test", "Before", aiprovider.KindAnthropic, "", "before-model", "",
	)
	if err != nil {
		t.Fatalf("create existing provider: %v", err)
	}
	data := aiProviderImportJSON(t, exportedAIProvider{
		ID: existing.ID, Label: existing.Label, Kind: existing.Kind, Model: "after-model",
	})

	_, err = cfg.importAIProviderCoordinated(data)
	assertUserErrorCode(t, err, string(aiprovider.ChangeBlockerProviderInUse))
	if got := mustAIProviderByID(t, cfg, existing.ID); got.Model != "before-model" {
		t.Errorf("refused compatibility import changed provider model to %q", got.Model)
	}
}

func TestImportAIProvider_CompatibilityPathAllowsLabelOnlyChange(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	var assertions atomic.Int32
	installAIProviderReviewCoordinator(cfg, func(string) error {
		assertions.Add(1)
		return usererror.New(
			string(aiprovider.ChangeBlockerProviderInUse),
			"This connection is used by an unfinished run. Wait for it to finish before changing it.",
		)
	})
	existing, err := cfg.createAIProviderUncoordinated(
		"provider-under-test", "Before", aiprovider.KindAnthropic, "", "same-model", "same-key",
	)
	if err != nil {
		t.Fatalf("create existing provider: %v", err)
	}
	data := aiProviderImportJSON(t, exportedAIProvider{
		ID: existing.ID, Label: "After", Kind: existing.Kind, Model: existing.Model, KeyRef: existing.KeyRef,
	})

	imported, err := cfg.importAIProviderCoordinated(data)
	if err != nil {
		t.Fatalf("compatibility import returned error: %v", err)
	}
	if imported.Label != "After" || assertions.Load() != 0 {
		t.Errorf("label-only import = label %q, assertions %d; want After and 0", imported.Label, assertions.Load())
	}
}

func installAIProviderReviewCoordinator(cfg *ConfigureService, assertUnused func(string) error) {
	if assertUnused == nil {
		assertUnused = func(string) error { return nil }
	}
	SetAIProviderMutationCoordinator(
		cfg,
		func(mutate func(assertUnused func(id string) error) error) error {
			return mutate(assertUnused)
		},
		func(id string, revision func() string) aiprovider.ChangeImpact {
			return aiprovider.ChangeImpact{
				ProviderID: id, ConfigRevision: revision(), MutationAllowed: true,
			}
		},
	)
}

func aiProviderImportJSON(t *testing.T, in exportedAIProvider) string {
	t.Helper()
	if in.Schema == "" {
		in.Schema = contract.SchemaID("aiprovider")
	}
	data, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal AI provider import: %v", err)
	}
	return string(data)
}

func mustAIProviderByID(t *testing.T, cfg *ConfigureService, id string) aiprovider.AIProvider {
	t.Helper()
	for _, provider := range cfg.AIProviders() {
		if provider.ID == id {
			return provider
		}
	}
	t.Fatalf("no AI provider with id %q", id)
	return aiprovider.AIProvider{}
}

func assertUserErrorCode(t *testing.T, err error, want string) {
	t.Helper()
	if err == nil {
		t.Fatalf("error = nil, want code %q", want)
	}
	got, ok := usererror.Of(err)
	if !ok || got.Code != want {
		t.Fatalf("error = %v, want user error code %q", err, want)
	}
}
