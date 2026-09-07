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
