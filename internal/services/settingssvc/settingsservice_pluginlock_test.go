package settingssvc

import (
	"log/slog"
	"testing"

	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/alicoding/mill/internal/services/triggersvc"
)

func TestPluginLock_RecordsOnConsentAndCompares(t *testing.T) {
	set := newExtensionsHarness(t)
	if lock, err := set.GetPluginLock(); err != nil || len(lock) != 0 {
		t.Fatal("fresh lock is not empty")
	}
	// An unreadable package identity cannot become approved.
	set.SetPluginHasher(nil)
	if err := set.SetPluginAllowed("mill-a", true); err == nil {
		t.Fatal("consent succeeded without a package inspector")
	}
	if lock, err := set.GetPluginLock(); err != nil || len(lock) != 0 {
		t.Fatal("failed capture wrote a partial lock")
	}
	set.SetPluginHasher(func(id string) (PluginGrantSnapshot, error) {
		if id == "mill-b" {
			return PluginGrantSnapshot{
				Version: "2.0.0", Hash: "sha256-b",
				Capabilities: []string{"open-url"}, Hosts: []string{"api.example.test"},
				NetworkGrantVersion: 1, NetworkMethods: map[string][]string{"api.example.test": {"GET", "POST"}},
				Kinds: []string{"views"}, UsesSecrets: true, CanvasHost: true,
			}, nil
		}
		return PluginGrantSnapshot{}, nil
	})
	wrote, err := set.RecordAllowedPluginsIfUnset([]string{"mill-b"})
	if err != nil || !wrote {
		t.Fatalf("initial record: wrote=%v err=%v", wrote, err)
	}
	if err := set.SetPluginAllowed("mill-b", true); err != nil {
		t.Fatal(err)
	}
	locks, err := set.GetPluginLock()
	if err != nil {
		t.Fatal(err)
	}
	if got := locks["mill-b"]; got.Version != "2.0.0" || got.Hash != "sha256-b" || got.NetworkGrantVersion != 1 || len(got.NetworkMethods["api.example.test"]) != 2 {
		t.Fatalf("lock = %+v", got)
	}
	if !set.PluginLockMatches("mill-b", "sha256-b") || set.PluginLockMatches("mill-b", "sha256-c") {
		t.Fatal("match compares the recorded hash")
	}
	if set.PluginLockMatches("mill-b", "") {
		t.Fatal("an unreadable current package identity matched approval")
	}
}

// RecordPluginLockNow re-baselines a RECORDED entry onto the hasher's
// current snapshot, for the pre-#806 lock migration (docs/goals/0420):
// a pre-#806 entry carries no capability-shaped grant fields at all
// (docs/goals/0375 S2 introduced them in the same change as CodeHash),
// which reads as "granted nothing" and widens on the plugin's very
// next declared capability -- a hash-only fix is not enough, so the
// migration re-baselines the WHOLE entry.
func TestPluginLock_RecordNow(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)
	wireApprovalMemory(set)
	WirePluginRemoval(set, func(id string, action func(string, bool, bool) error) error { return action("", false, true) })
	set.SetPluginHasher(func(id string) (PluginGrantSnapshot, error) {
		return PluginGrantSnapshot{Version: "1.0.0", Hash: "sha256-new", Capabilities: []string{"open-url"}, NetworkGrantVersion: 1, NetworkMethods: map[string][]string{}}, nil
	})
	if err := set.RecordPluginLockNow("mill-a"); err != nil {
		t.Fatal(err)
	}
	locks, err := set.GetPluginLock()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := locks["mill-a"]; ok {
		t.Fatal("re-baselining an unrecorded plugin created an entry")
	}
	// Seed a pre-#806 entry directly: hash only, no capability-shaped
	// grant at all -- the format the migration must repair.
	if err := store.Set("settings-plugin-lock", `{"mill-a":{"version":"0.9.0","hash":"sha256-old"}}`); err != nil {
		t.Fatal(err)
	}
	set = NewSettingsService(store, trig, false)
	wireApprovalMemory(set)
	WirePluginRemoval(set, func(id string, action func(string, bool, bool) error) error { return action("", false, true) })
	set.SetPluginHasher(func(id string) (PluginGrantSnapshot, error) {
		return PluginGrantSnapshot{Version: "1.0.0", Hash: "sha256-new", Capabilities: []string{"open-url"}, NetworkGrantVersion: 1, NetworkMethods: map[string][]string{}}, nil
	})
	if err := set.RecordPluginLockNow("mill-a"); err != nil {
		t.Fatal(err)
	}
	locks, err = set.GetPluginLock()
	if err != nil {
		t.Fatal(err)
	}
	got := locks["mill-a"]
	if got.Hash != "sha256-new" || got.Version != "1.0.0" || len(got.Capabilities) != 1 || got.Capabilities[0] != "open-url" {
		t.Fatalf("lock after re-baseline = %+v, want the hasher's current snapshot whole", got)
	}
}

// The grant record round-trips the whole capability shape, not just
// the hash -- the baseline widen detection compares a later manifest
// against (docs/goals/0375 S2).
func TestPluginLock_GrantRecordRoundTrips(t *testing.T) {
	set := newExtensionsHarness(t)
	if _, ok, err := set.PluginGrant("mill-a"); err != nil || ok {
		t.Fatal("nothing recorded yet")
	}
	set.SetPluginHasher(func(id string) (PluginGrantSnapshot, error) {
		return PluginGrantSnapshot{
			Version: "1.0.0", Hash: "sha256-a",
			Capabilities: []string{"open-url", "fetch"}, Hosts: []string{"api.example.test"}, AnyHost: false,
			NetworkGrantVersion: 1, NetworkMethods: map[string][]string{"api.example.test": {"GET", "POST"}},
			Kinds: []string{"steps", "views"}, UsesSecrets: true, CanvasHost: true,
		}, nil
	})
	if err := set.SetPluginAllowed("mill-a", true); err != nil {
		t.Fatal(err)
	}
	got, ok, err := set.PluginGrant("mill-a")
	if err != nil || !ok {
		t.Fatal("expected a recorded grant")
	}
	want := PluginLockEntry{
		Version: "1.0.0", Hash: "sha256-a",
		Capabilities: []string{"open-url", "fetch"}, Hosts: []string{"api.example.test"},
		NetworkGrantVersion: 1, NetworkMethods: map[string][]string{"api.example.test": {"GET", "POST"}},
		Kinds: []string{"steps", "views"}, UsesSecrets: true, CanvasHost: true,
	}
	if got.Version != want.Version || got.Hash != want.Hash || got.UsesSecrets != want.UsesSecrets || got.CanvasHost != want.CanvasHost ||
		len(got.Capabilities) != 2 || len(got.Hosts) != 1 || len(got.Kinds) != 2 {
		t.Fatalf("grant = %+v, want %+v", got, want)
	}
	// Withdrawing consent forgets the whole grant, not just the hash.
	if err := set.SetPluginAllowed("mill-a", false); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := set.PluginGrant("mill-a"); err != nil || ok {
		t.Fatal("expected the grant to be forgotten with consent")
	}
}
