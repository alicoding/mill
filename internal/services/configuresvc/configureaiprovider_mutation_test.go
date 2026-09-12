package configuresvc

import (
	"errors"
	"sync/atomic"
	"testing"

	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/domain/usererror"
	"github.com/alicoding/mill/internal/services/seeding"
	"github.com/alicoding/mill/internal/services/servicetest"
)

func TestAIProviderMutation_UnwiredRuntimeChangeFailsClosedButLabelChangeRemainsAvailable(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	SetAIProviderMutationCoordinator(cfg, nil, nil)
	existing, err := cfg.createAIProviderUncoordinated(
		"provider-under-test", "Before", aiprovider.KindAnthropic, "", "before-model", "",
	)
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}

	_, err = cfg.updateAIProviderCoordinated(
		existing.ID, existing.Label, existing.Kind, existing.BaseURL, "after-model", existing.KeyRef,
	)
	assertUserErrorCode(t, err, string(aiprovider.ChangeBlockerProviderCheckUnavailable))
	if got := mustAIProviderByID(t, cfg, existing.ID); got.Model != "before-model" {
		t.Errorf("refused update changed model to %q", got.Model)
	}

	updated, err := cfg.updateAIProviderCoordinated(
		existing.ID, "After", existing.Kind, existing.BaseURL, existing.Model, existing.KeyRef,
	)
	if err != nil {
		t.Fatalf("label-only update with unwired coordinator: %v", err)
	}
	if updated.Label != "After" {
		t.Errorf("updated label = %q, want After", updated.Label)
	}
}

func TestAIProviderMutation_PersistenceFailureRollsBackRuntimeUpdate(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	installAIProviderReviewCoordinator(cfg, nil)
	existing, err := cfg.createAIProviderUncoordinated(
		"provider-under-test", "Before", aiprovider.KindAnthropic, "", "before-model", "",
	)
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	fakeStore, ok := cfg.store.(*servicetest.FakeStore)
	if !ok {
		t.Fatalf("test store type = %T, want *servicetest.FakeStore", cfg.store)
	}
	persistErr := errors.New("fake persistence failure")
	fakeStore.SetErr = persistErr

	_, err = cfg.updateAIProviderCoordinated(
		existing.ID, existing.Label, existing.Kind, existing.BaseURL, "after-model", existing.KeyRef,
	)
	if !errors.Is(err, persistErr) {
		t.Fatalf("runtime update error = %v, want persistence failure", err)
	}
	if got := mustAIProviderByID(t, cfg, existing.ID); got.Model != "before-model" {
		t.Errorf("failed update left model %q, want rollback to before-model", got.Model)
	}
}

func TestAIProviderMutation_SameRuntimeAndSecretReferenceDoesNotRequireUnused(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	var assertions atomic.Int32
	installAIProviderReviewCoordinator(cfg, func(string) error {
		assertions.Add(1)
		return providerInUseTestError()
	})
	existing, err := cfg.createAIProviderUncoordinated(
		"provider-under-test", "Before", aiprovider.KindAnthropic, "", "same-model", "vault:same-reference",
	)
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	updated, err := cfg.updateAIProviderCoordinated(
		existing.ID, existing.Label, existing.Kind, existing.BaseURL, existing.Model, existing.KeyRef,
	)
	if err != nil {
		t.Fatalf("same-reference update: %v", err)
	}
	if updated.KeyRef != existing.KeyRef || assertions.Load() != 0 {
		t.Fatalf("same-reference update = keyRef %q, assertions %d; want unchanged and 0", updated.KeyRef, assertions.Load())
	}
}

func TestAIProviderMutation_ResetAndRestoreRecheckUse(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	installAIProviderReviewCoordinator(cfg, func(string) error {
		return providerInUseTestError()
	})
	golden, ok := findGoldenAIProvider(aiprovider.ExampleLocalOllamaID)
	if !ok {
		t.Fatal("built-in AI provider missing")
	}
	modified := golden
	modified.Model = "modified-model"
	modified.Seed = seedorigin.Origin{SeedRevision: golden.Seed.SeedRevision, Modified: true}
	cfg.aiProviders = []aiprovider.AIProvider{modified}

	_, err := cfg.resetAIProviderToSeedCoordinated(golden.ID)
	assertUserErrorCode(t, err, string(aiprovider.ChangeBlockerProviderInUse))
	if got := mustAIProviderByID(t, cfg, golden.ID); got.Model != "modified-model" {
		t.Errorf("refused reset changed model to %q", got.Model)
	}

	cfg.aiProviders = nil
	if err := seeding.RecordTombstone(cfg.store, golden.ID); err != nil {
		t.Fatalf("RecordTombstone: %v", err)
	}
	_, err = cfg.restoreAIProviderCoordinated(golden.ID)
	assertUserErrorCode(t, err, string(aiprovider.ChangeBlockerProviderInUse))
	if len(cfg.AIProviders()) != 0 {
		t.Errorf("refused restore created providers: %+v", cfg.AIProviders())
	}
}

func TestAIProviderMutation_DeleteUndoRechecksUse(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	blocked := false
	installAIProviderReviewCoordinator(cfg, func(string) error {
		if blocked {
			return providerInUseTestError()
		}
		return nil
	})
	existing, err := cfg.createAIProviderUncoordinated(
		"provider-under-test", "Before", aiprovider.KindAnthropic, "", "before-model", "",
	)
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := cfg.deleteAIProviderCoordinated(existing.ID); err != nil {
		t.Fatalf("delete provider: %v", err)
	}
	blocked = true

	err = cfg.UndoDelete("aiprovider", existing.ID)
	assertUserErrorCode(t, err, string(aiprovider.ChangeBlockerProviderInUse))
	if len(cfg.AIProviders()) != 0 {
		t.Errorf("refused undo restored providers: %+v", cfg.AIProviders())
	}
}

func TestReconcileBuiltInAIProviders_RefusalLeavesPlanUnapplied(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	originalBuiltIn := aiProviderDescriptor.BuiltIn
	golden := aiprovider.BuiltIn()[0]
	golden.Seed = seedorigin.Stamp(2)
	golden.Model = "new-seed-model"
	aiProviderDescriptor.BuiltIn = func() []aiprovider.AIProvider { return []aiprovider.AIProvider{golden} }
	t.Cleanup(func() { aiProviderDescriptor.BuiltIn = originalBuiltIn })
	existing := golden
	existing.Model = "old-seed-model"
	existing.Seed = seedorigin.Stamp(1)
	cfg.aiProviders = []aiprovider.AIProvider{existing}
	installAIProviderReviewCoordinator(cfg, func(string) error {
		return providerInUseTestError()
	})

	err := ReconcileBuiltInAIProviders(cfg)
	assertUserErrorCode(t, err, string(aiprovider.ChangeBlockerProviderInUse))
	if got := mustAIProviderByID(t, cfg, golden.ID); got.Model != "old-seed-model" || got.Seed.SeedRevision != 1 {
		t.Errorf("refused seed upgrade changed provider: %+v", got)
	}
}

func TestReconcileBuiltInAIProviders_PersistenceFailureRollsBackBatch(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	installAIProviderReviewCoordinator(cfg, nil)
	fakeStore := cfg.store.(*servicetest.FakeStore)
	persistErr := errors.New("fake reconciliation persistence failure")
	fakeStore.SetErr = persistErr

	err := ReconcileBuiltInAIProviders(cfg)
	if !errors.Is(err, persistErr) {
		t.Fatalf("ReconcileBuiltInAIProviders error = %v, want persistence failure", err)
	}
	if len(cfg.AIProviders()) != 0 {
		t.Fatalf("failed reconciliation left providers in memory: %+v", cfg.AIProviders())
	}
}

func TestAIProviderMutation_DeleteJournalRedoRechecksUse(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	blocked := false
	installAIProviderReviewCoordinator(cfg, func(string) error {
		if blocked {
			return providerInUseTestError()
		}
		return nil
	})
	var undo, redo func() error
	cfg.WireUndoJournal(func(_, _, _, _ string, undoFn, redoFn func() error) {
		undo, redo = undoFn, redoFn
	})
	existing, err := cfg.createAIProviderUncoordinated(
		"provider-under-test", "Before", aiprovider.KindAnthropic, "", "before-model", "",
	)
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := cfg.deleteAIProviderCoordinated(existing.ID); err != nil {
		t.Fatalf("delete provider: %v", err)
	}
	if undo == nil || redo == nil {
		t.Fatal("delete did not register journal inverses")
	}
	if err := undo(); err != nil {
		t.Fatalf("journal undo: %v", err)
	}
	blocked = true
	err = redo()
	assertUserErrorCode(t, err, string(aiprovider.ChangeBlockerProviderInUse))
	if got := mustAIProviderByID(t, cfg, existing.ID); got.Model != existing.Model {
		t.Fatalf("refused redo changed provider: %+v", got)
	}
}

func providerInUseTestError() error {
	return usererror.New(
		string(aiprovider.ChangeBlockerProviderInUse),
		"This connection is used by an unfinished run. Wait for it to finish before changing it.",
	)
}
