package guardrailsvc

// Durability tests for the generic pending-action store (docs/adr/0047
// §5.4's follow-up). TestGateWrite_PersistFailureAtParkTime and
// TestResolveMCPWrite_PersistFailure from mcpsvc's own (pre-migration)
// millmcpservice_approval_test.go are MIGRATED here as
// TestPendingActionStore_ParkPersistFailure_LeavesNoRecord and
// TestPendingActionStore_ResolvePersistFailure_StillAppliesButReturnsError
// -- the same property (a park/resolution that fails to durably save
// must not look successful, and must not silently swallow the error),
// now pinned directly against the store both mcpsvc and
// RequestGuardedAction share, rather than against mcpsvc's own
// (retired) bespoke persistence.

import (
	"errors"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/services/servicetest"
)

var errFakePendingStorePersist = errors.New("fake persist failure")

// --- Restart survival (docs/adr/0032 §1's core claim, generalized) ---

func TestPendingActionStore_RestartSurvival_PendingRecordSurvivesNewInstance(t *testing.T) {
	store := servicetest.NewFakeStore()
	s1 := NewPendingActionStore(store)

	rec, err := s1.Park(GuardedAction{Kind: "test-kind", Description: "survives a restart"}, []byte(`{"tool":"x"}`))
	if err != nil {
		t.Fatalf("Park: %v", err)
	}

	// A fresh instance against the SAME store, standing in for a
	// process restart.
	s2 := NewPendingActionStore(store)
	pending, _ := s2.Pending("", time.Hour)
	if len(pending) != 1 || pending[0].ID != rec.ID {
		t.Fatalf("pending record did not survive across store instances: %+v", pending)
	}
	if string(pending[0].Payload) != `{"tool":"x"}` {
		t.Errorf("Payload = %q, want it to survive the restart intact", pending[0].Payload)
	}

	resolved, _, err := s2.Resolve(rec.ID, true, "", time.Hour, nil)
	if err != nil {
		t.Fatalf("Resolve on the restarted instance: %v", err)
	}
	if resolved.Status != GuardedActionApproved {
		t.Errorf("Status = %q, want approved", resolved.Status)
	}
}

// --- At-most-once (docs/adr/0032 §1) ---

func TestPendingActionStore_Resolve_AtMostOnce_ApplyRunsExactlyOnce(t *testing.T) {
	store := servicetest.NewFakeStore()
	s := NewPendingActionStore(store)
	rec, err := s.Park(GuardedAction{Kind: "k"}, nil)
	if err != nil {
		t.Fatalf("Park: %v", err)
	}

	applyCalls := 0
	apply := func([]byte) (string, error) {
		applyCalls++
		return "done", nil
	}

	if _, _, err := s.Resolve(rec.ID, true, "", time.Hour, apply); err != nil {
		t.Fatalf("first Resolve: %v", err)
	}
	if applyCalls != 1 {
		t.Fatalf("applyCalls after first Resolve = %d, want 1", applyCalls)
	}

	if _, _, err := s.Resolve(rec.ID, true, "", time.Hour, apply); err == nil {
		t.Fatal("resolving an already-resolved record a second time: want error, got nil")
	}
	if applyCalls != 1 {
		t.Errorf("applyCalls after second (rejected) Resolve = %d, want still 1 -- at-most-once", applyCalls)
	}
}

func TestPendingActionStore_Withdraw_AtMostOnce(t *testing.T) {
	store := servicetest.NewFakeStore()
	s := NewPendingActionStore(store)
	rec, err := s.Park(GuardedAction{Kind: "k"}, nil)
	if err != nil {
		t.Fatalf("Park: %v", err)
	}
	if _, _, err := s.Withdraw(rec.ID, "no longer needed", time.Hour); err != nil {
		t.Fatalf("first Withdraw: %v", err)
	}
	if _, _, err := s.Withdraw(rec.ID, "no longer needed", time.Hour); err == nil {
		t.Fatal("withdrawing an already-resolved record a second time: want error, got nil")
	}
	if got, _ := s.Pending("", time.Hour); len(got) != 0 {
		t.Errorf("Pending() after withdrawal = %+v, want empty", got)
	}
}

// --- Persist-failure migrations from mcpsvc's own pre-migration tests ---

func TestPendingActionStore_ParkPersistFailure_LeavesNoRecord(t *testing.T) {
	store := servicetest.NewFakeStore()
	s := NewPendingActionStore(store)

	store.SetErr = errFakePendingStorePersist
	_, err := s.Park(GuardedAction{Kind: "k", Description: "a park that should never durably save"}, nil)
	if err == nil {
		t.Fatal("Park() with a failing store: want error, got nil")
	}
	store.SetErr = nil

	if pending, _ := s.Pending("", time.Hour); len(pending) != 0 {
		t.Errorf("Pending() after a failed park = %+v, want empty -- a record that failed to durably persist must not sit in memory looking parked", pending)
	}
}

func TestPendingActionStore_ResolvePersistFailure_StillAppliesButReturnsError(t *testing.T) {
	store := servicetest.NewFakeStore()
	s := NewPendingActionStore(store)
	rec, err := s.Park(GuardedAction{Kind: "k"}, nil)
	if err != nil {
		t.Fatalf("Park: %v", err)
	}

	store.SetErr = errFakePendingStorePersist
	resolved, _, err := s.Resolve(rec.ID, false, "denied by the reviewer", time.Hour, nil)
	if err == nil {
		t.Fatal("Resolve(deny) with a failing store: want error, got nil")
	}
	store.SetErr = nil

	// The decision itself is real even though it failed to durably save
	// (mirrors mcpsvc's own pre-migration finalizeLocked -- see Resolve's
	// doc comment): rolling it back would risk a double-apply on a
	// crash/restart racing an unpersisted approval.
	if resolved.Status != GuardedActionDenied {
		t.Errorf("Status = %q, want denied -- the denial decision itself is real even though it failed to durably save", resolved.Status)
	}

	got, ok := s.Get(rec.ID, time.Hour)
	if !ok {
		t.Fatal("Get after a failed-to-persist denial: record disappeared entirely")
	}
	if got.Status != GuardedActionDenied {
		t.Errorf("Get().Status = %q, want denied", got.Status)
	}
}

// --- Courtesy-window semantics (AwaitDecision never deletes on timeout) ---

func TestPendingActionStore_AwaitDecision_TimeoutLeavesRecordPending(t *testing.T) {
	store := servicetest.NewFakeStore()
	s := NewPendingActionStore(store)
	rec, err := s.Park(GuardedAction{Kind: "k"}, nil)
	if err != nil {
		t.Fatalf("Park: %v", err)
	}

	if _, decided := s.AwaitDecision(rec.ID, 20*time.Millisecond); decided {
		t.Fatal("AwaitDecision() with nobody resolving: want decided=false")
	}
	if pending, _ := s.Pending("", time.Hour); len(pending) != 1 {
		t.Fatalf("Pending() after AwaitDecision timeout = %+v, want the record still parked (courtesy timeout must not delete it)", pending)
	}

	resolved, _, err := s.Resolve(rec.ID, true, "", time.Hour, func([]byte) (string, error) { return "ok", nil })
	if err != nil {
		t.Fatalf("Resolve after the courtesy window elapsed: %v", err)
	}
	if resolved.Status != GuardedActionApproved || resolved.ResultText != "ok" {
		t.Errorf("Resolve after timeout = %+v, want it to still apply normally", resolved)
	}
}

func TestPendingActionStore_AwaitDecision_ResolvedBeforeAwait_ReturnsImmediately(t *testing.T) {
	store := servicetest.NewFakeStore()
	s := NewPendingActionStore(store)
	rec, err := s.Park(GuardedAction{Kind: "k"}, nil)
	if err != nil {
		t.Fatalf("Park: %v", err)
	}
	if _, _, err := s.Resolve(rec.ID, true, "", time.Hour, nil); err != nil {
		t.Fatalf("Resolve: %v", err)
	}

	got, decided := s.AwaitDecision(rec.ID, 2*time.Second)
	if !decided {
		t.Fatal("AwaitDecision() after an already-resolved record: want decided=true immediately")
	}
	if got.Status != GuardedActionApproved {
		t.Errorf("AwaitDecision().Status = %q, want approved", got.Status)
	}
}

// --- Expiry sweep (mirrors mcpsvc's own retired Expiry test) ---

func TestPendingActionStore_Expiry_MarksExpiredAndStopsApplyingOnResolve(t *testing.T) {
	const shortRetention = 30 * time.Millisecond

	store := servicetest.NewFakeStore()
	s := NewPendingActionStore(store)
	rec, err := s.Park(GuardedAction{Kind: "k"}, nil)
	if err != nil {
		t.Fatalf("Park: %v", err)
	}

	time.Sleep(80 * time.Millisecond)

	got, ok := s.Get(rec.ID, shortRetention)
	if !ok || got.Status != GuardedActionExpired {
		t.Fatalf("Get() after the retention window elapsed = %+v (ok=%v), want expired", got, ok)
	}

	applied := false
	if _, _, err := s.Resolve(rec.ID, true, "", shortRetention, func([]byte) (string, error) { applied = true; return "", nil }); err == nil {
		t.Error("Resolve() on an expired record: want error, got nil")
	}
	if applied {
		t.Error("Resolve() on an expired record must not call apply")
	}
}

// --- MergeLegacyPendingActions: the upgrade path ---

func TestMergeLegacyPendingActions_ImportsRecordsAndNeverOverwritesExisting(t *testing.T) {
	store := servicetest.NewFakeStore()
	createdAt := time.Now().Add(-time.Minute)
	legacy := map[string]LegacyGuardedAction{
		"legacy-1": {
			ID: "legacy-1", Kind: "mcp-write", Description: "a pre-migration pending write",
			CreatedAt: createdAt, Status: GuardedActionPending, Payload: []byte(`{"toolName":"import_workflow"}`),
		},
	}
	if err := MergeLegacyPendingActions(store, legacy); err != nil {
		t.Fatalf("MergeLegacyPendingActions: %v", err)
	}

	s := NewPendingActionStore(store)
	got, ok := s.Get("legacy-1", time.Hour)
	if !ok {
		t.Fatal("migrated record not found in the new store")
	}
	if got.Kind != "mcp-write" || got.Status != GuardedActionPending {
		t.Errorf("migrated record = %+v, want the legacy fields carried through", got)
	}
	if !got.CreatedAt.Equal(createdAt) {
		t.Errorf("migrated CreatedAt = %v, want the original %v preserved (not re-minted)", got.CreatedAt, createdAt)
	}

	// A second merge with a DIFFERENT description for the same ID must
	// never overwrite the already-migrated (and possibly since-mutated)
	// new-format record.
	legacy["legacy-1"] = LegacyGuardedAction{ID: "legacy-1", Kind: "mcp-write", Description: "should never win", CreatedAt: createdAt, Status: GuardedActionPending}
	if err := MergeLegacyPendingActions(store, legacy); err != nil {
		t.Fatalf("second MergeLegacyPendingActions: %v", err)
	}
	s2 := NewPendingActionStore(store)
	got2, _ := s2.Get("legacy-1", time.Hour)
	if got2.Description != "a pre-migration pending write" {
		t.Errorf("Description after a second merge = %q, want the original preserved, never overwritten", got2.Description)
	}
}

func TestMergeLegacyPendingActions_EmptyInput_NoOp(t *testing.T) {
	store := servicetest.NewFakeStore()
	if err := store.Set(guardedPendingActionsKey, "sentinel"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := MergeLegacyPendingActions(store, nil); err != nil {
		t.Fatalf("MergeLegacyPendingActions(nil): %v", err)
	}
	if got := store.Get(guardedPendingActionsKey); got != "sentinel" {
		t.Errorf("guardedPendingActionsKey = %v, want untouched by an empty merge", got)
	}
}
