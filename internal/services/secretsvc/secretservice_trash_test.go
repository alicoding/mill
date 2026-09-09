package secretsvc

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/adapters/secretvault"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// TestTrashSecret_MovesToTrash_ExcludesFromListAndAudits proves
// DeleteSecret's new behavior (goal 0406): the row leaves ListSecrets,
// appears in ListTrash with an ExpiresAt TrashRetention out, and the
// audit trail gets OutcomeDeleted, never a permanent removal.
func TestTrashSecret_MovesToTrash_ExcludesFromListAndAudits(t *testing.T) {
	s := newAuditedTestService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	created, err := s.CreateSecret("API", "", "trash-pw-fake", "", "", nil, "", "", nil)
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}

	if err := s.DeleteSecret(created.ID); err != nil {
		t.Fatalf("DeleteSecret: %v", err)
	}

	list, err := s.ListSecrets()
	if err != nil {
		t.Fatalf("ListSecrets: %v", err)
	}
	for _, e := range list {
		if e.ID == created.ID {
			t.Fatalf("trashed entry %q still in ListSecrets", created.ID)
		}
	}

	trash, err := s.ListTrash()
	if err != nil {
		t.Fatalf("ListTrash: %v", err)
	}
	if len(trash) != 1 || trash[0].ID != created.ID || trash[0].Label != "API" {
		t.Fatalf("ListTrash = %+v, want one row for %q", trash, created.ID)
	}
	wantExpiry := trash[0].DeletedAt.Add(TrashRetention)
	if !trash[0].ExpiresAt.Equal(wantExpiry) {
		t.Fatalf("ExpiresAt = %v, want %v", trash[0].ExpiresAt, wantExpiry)
	}

	records, total, err := s.auditStore.List(secretauditFilter(), 10, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total != 1 || len(records) != 1 {
		t.Fatalf("audit rows = %d, want exactly 1: %+v", total, records)
	}
	if records[0].Outcome != secretaudit.OutcomeDeleted || records[0].Context != secretaudit.ContextUITrash {
		t.Errorf("Outcome/Context = %q/%q, want deleted/%q", records[0].Outcome, records[0].Context, secretaudit.ContextUITrash)
	}
}

// TestRestoreSecret_BackInTheList proves the round trip: RestoreSecret
// undoes TrashSecret and audits OutcomeRestored.
func TestRestoreSecret_BackInTheList(t *testing.T) {
	s := newAuditedTestService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	created, err := s.CreateSecret("API", "", "restore-pw-fake", "", "", nil, "", "", nil)
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}
	if err := s.DeleteSecret(created.ID); err != nil {
		t.Fatalf("DeleteSecret: %v", err)
	}

	if err := s.RestoreSecret(created.ID); err != nil {
		t.Fatalf("RestoreSecret: %v", err)
	}

	list, err := s.ListSecrets()
	if err != nil {
		t.Fatalf("ListSecrets: %v", err)
	}
	var found bool
	for _, e := range list {
		if e.ID == created.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("restored entry %q not back in ListSecrets", created.ID)
	}
	trash, err := s.ListTrash()
	if err != nil {
		t.Fatalf("ListTrash: %v", err)
	}
	if len(trash) != 0 {
		t.Fatalf("ListTrash after restore = %v, want empty", trash)
	}

	records, _, err := s.auditStore.List(secretauditFilter(), 10, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	var sawRestored bool
	for _, r := range records {
		if r.Outcome == secretaudit.OutcomeRestored && r.Context == secretaudit.ContextUIRestore {
			sawRestored = true
		}
	}
	if !sawRestored {
		t.Fatalf("no OutcomeRestored/%q row in %+v", secretaudit.ContextUIRestore, records)
	}
}

// TestDestroySecret_PermanentlyGone proves "Delete forever": the entry
// leaves Trash entirely and audits OutcomeDestroyed.
func TestDestroySecret_PermanentlyGone(t *testing.T) {
	s := newAuditedTestService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	created, err := s.CreateSecret("API", "", "destroy-pw-fake", "", "", nil, "", "", nil)
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}
	if err := s.DeleteSecret(created.ID); err != nil {
		t.Fatalf("DeleteSecret: %v", err)
	}

	if err := s.DestroySecret(created.ID); err != nil {
		t.Fatalf("DestroySecret: %v", err)
	}

	trash, err := s.ListTrash()
	if err != nil {
		t.Fatalf("ListTrash: %v", err)
	}
	if len(trash) != 0 {
		t.Fatalf("ListTrash after DestroySecret = %v, want empty", trash)
	}

	records, _, err := s.auditStore.List(secretauditFilter(), 10, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	var sawDestroyed bool
	for _, r := range records {
		if r.Outcome == secretaudit.OutcomeDestroyed && r.Context == secretaudit.ContextUIDestroy {
			sawDestroyed = true
		}
	}
	if !sawDestroyed {
		t.Fatalf("no OutcomeDestroyed/%q row in %+v", secretaudit.ContextUIDestroy, records)
	}
}

// TestResolveSecretValue_TrashedEntry_ReportsInTrash proves a reference
// to a trashed entry fails closed with the distinct FailureKindInTrash
// (goal 0406), never the plain "unrecognized" state a fully gone entry
// gets.
func TestResolveSecretValue_TrashedEntry_ReportsInTrash(t *testing.T) {
	s := newAuditedTestService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	created, err := s.CreateSecret("API", "", "inTrash-pw-fake", "", "", nil, "", "", nil)
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}
	if err := s.DeleteSecret(created.ID); err != nil {
		t.Fatalf("DeleteSecret: %v", err)
	}

	if _, err := s.ResolveSecretValue(created.ID, secretaudit.AccessContext{Context: secretaudit.ContextExecEnv}); err == nil {
		t.Fatal("ResolveSecretValue for a trashed id returned nil error, want an error")
	}

	records, _, err := s.auditStore.List(secretauditFilter(), 10, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	// records is newest-first (secretauditstore.Store.List's own
	// contract) -- the ResolveSecretValue error is the most recent row,
	// after the earlier DeleteSecret success.
	newest := records[0]
	if newest.FailureKind != secretaudit.FailureKindInTrash {
		t.Errorf("FailureKind = %q, want %q", newest.FailureKind, secretaudit.FailureKindInTrash)
	}
}

// TestSecretRefTrashed_NamesTheTrashedEntry proves the pre-run verdict
// seam (composition.SetSecretTrashedCheck's own lookup): a
// "vault:<id>" reference to a trashed entry reports trashed=true with
// its label; a live entry and a provider-qualified reference both
// report false.
func TestSecretRefTrashed_NamesTheTrashedEntry(t *testing.T) {
	s := newTestService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	created, err := s.CreateSecret("Bank Token", "", "secretref-pw-fake", "", "", nil, "", "", nil)
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}

	if trashed, _ := s.SecretRefTrashed("vault:" + created.ID); trashed {
		t.Fatal("a live entry reported trashed")
	}
	if err := s.DeleteSecret(created.ID); err != nil {
		t.Fatalf("DeleteSecret: %v", err)
	}
	trashed, label := s.SecretRefTrashed("vault:" + created.ID)
	if !trashed || label != "Bank Token" {
		t.Fatalf("SecretRefTrashed = %v, %q, want true, Bank Token", trashed, label)
	}
	if trashed, _ := s.SecretRefTrashed("env:src/KEY"); trashed {
		t.Fatal("a provider-qualified reference reported trashed")
	}
}

// TestTrashSweepTick_DueAfterInterval_DestroysPastRetention proves the
// daily-cadence scheduling itself (not just the vault-level SweepTrash
// this pins in secretvault_trash_test.go): trashSweepTick is a no-op
// until trashSweepInterval has passed on the injected clock, then
// sweeps and destroys anything past TrashRetention. Built directly
// (not newAuditedTestService) and StopAutoLock'd immediately -- the
// background poll goroutine calls trashSweepTick on its own 10s
// cadence too, which would race this test's trashClockFn swap under
// -race (the same reasoning TestAutoLock_FiresPastThreshold's own
// idleTimeFn swap already documents).
func TestTrashSweepTick_DueAfterInterval_DestroysPastRetention(t *testing.T) {
	dir := t.TempDir()
	s := NewSecretService(secretvault.New(filepath.Join(dir, "secrets.kdbx")), credential.NewInMemory(), servicetest.NewFakeStore())
	s.StopAutoLock()
	if err := s.OpenAudit(filepath.Join(dir, "execution.db"), nil); err != nil {
		t.Fatalf("OpenAudit: %v", err)
	}
	t.Cleanup(func() { _ = s.CloseAudit() })
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}

	origClock := trashClockFn
	t.Cleanup(func() { trashClockFn = origClock })
	now := time.Now()
	trashClockFn = func() time.Time { return now }
	// Establishes lastTrashSweep = now -- nothing is trashed yet, so
	// this tick has nothing to destroy either way.
	s.trashSweepTick()

	created, err := s.CreateSecret("API", "", "sweep-pw-fake", "", "", nil, "", "", nil)
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}
	if err := s.DeleteSecret(created.ID); err != nil {
		t.Fatalf("DeleteSecret: %v", err)
	}

	// A tick still at the SAME "now" is not due yet (trashSweepInterval
	// hasn't passed since the tick above).
	s.trashSweepTick()
	trash, err := s.ListTrash()
	if err != nil {
		t.Fatalf("ListTrash: %v", err)
	}
	if len(trash) != 1 {
		t.Fatalf("ListTrash after an immediate tick = %v, want the entry still there", trash)
	}

	// 31 days later, past both the daily cadence and the retention
	// window: the tick is due and the sweep destroys the entry.
	trashClockFn = func() time.Time { return now.Add(31 * 24 * time.Hour) }
	s.trashSweepTick()
	trash, err = s.ListTrash()
	if err != nil {
		t.Fatalf("ListTrash: %v", err)
	}
	if len(trash) != 0 {
		t.Fatalf("ListTrash after the due tick = %v, want empty", trash)
	}

	records, _, err := s.auditStore.List(secretauditFilter(), 10, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	var sawSweep bool
	for _, r := range records {
		if r.Outcome == secretaudit.OutcomeDestroyed && r.Context == secretaudit.ContextTrashSweep {
			sawSweep = true
		}
	}
	if !sawSweep {
		t.Fatalf("no OutcomeDestroyed/%q row in %+v", secretaudit.ContextTrashSweep, records)
	}
}
