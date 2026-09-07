package settingssvc

import (
	"log/slog"
	"testing"

	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/alicoding/mill/internal/services/triggersvc"
)

func TestGetAuditRetentionEntries_DefaultsWhenUnset(t *testing.T) {
	set := newTestSettingsService(t)
	if got := set.GetAuditRetentionEntries(); got != AuditRetentionEntriesDefault {
		t.Errorf("GetAuditRetentionEntries() = %d, want default %d", got, AuditRetentionEntriesDefault)
	}
}

func TestSetAuditRetentionEntries_PersistsAndReadsBackAsInt(t *testing.T) {
	set := newTestSettingsService(t)
	if err := set.SetAuditRetentionEntries(5000); err != nil {
		t.Fatalf("SetAuditRetentionEntries: %v", err)
	}
	if got := set.GetAuditRetentionEntries(); got != 5000 {
		t.Errorf("GetAuditRetentionEntries() = %d, want 5000", got)
	}
}

func TestSetAuditRetentionEntries_RejectsNonPositive(t *testing.T) {
	set := newTestSettingsService(t)
	for _, n := range []int{0, -1} {
		if err := set.SetAuditRetentionEntries(n); err == nil {
			t.Errorf("SetAuditRetentionEntries(%d) = nil error, want a rejection", n)
		}
	}
	if got := set.GetAuditRetentionEntries(); got != AuditRetentionEntriesDefault {
		t.Errorf("a rejected Set must not change the persisted value: got %d, want default %d", got, AuditRetentionEntriesDefault)
	}
}

// TestSetAuditRetentionEntries_InvokesTheWiredCallback is the goal
// 0351 review fix's own proof: a new cap takes effect immediately
// (the setting's own caption promises "removed automatically"), not
// only at the next restart, by calling whatever
// SetAuditRetentionChanged wired.
func TestSetAuditRetentionEntries_InvokesTheWiredCallback(t *testing.T) {
	set := newTestSettingsService(t)
	var got int
	calls := 0
	set.SetAuditRetentionChanged(func(n int) {
		got = n
		calls++
	})
	if err := set.SetAuditRetentionEntries(250); err != nil {
		t.Fatalf("SetAuditRetentionEntries: %v", err)
	}
	if calls != 1 || got != 250 {
		t.Errorf("callback called %d time(s) with %d, want exactly once with 250", calls, got)
	}
}

func TestSetAuditRetentionEntries_RejectedValueNeverInvokesTheCallback(t *testing.T) {
	set := newTestSettingsService(t)
	calls := 0
	set.SetAuditRetentionChanged(func(int) { calls++ })
	if err := set.SetAuditRetentionEntries(0); err == nil {
		t.Fatal("SetAuditRetentionEntries(0) = nil error, want a rejection")
	}
	if calls != 0 {
		t.Errorf("callback called %d time(s) for a rejected value, want 0", calls)
	}
}

// TestGetAuditRetentionEntries_ReadsBackFloat64AfterReload mirrors what
// a value looks like after a real restart: kvstore.Load's own
// json.Unmarshal decodes a persisted number into `any` as float64, not
// int (this test's own store skips the JSON round trip, so the float64
// value is set directly to stand in for a reloaded one).
func TestGetAuditRetentionEntries_ReadsBackFloat64AfterReload(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)
	if err := store.Set(auditRetentionEntriesKey, float64(7500)); err != nil {
		t.Fatal(err)
	}
	if got := set.GetAuditRetentionEntries(); got != 7500 {
		t.Errorf("GetAuditRetentionEntries() after a float64-shaped reload = %d, want 7500", got)
	}
}
