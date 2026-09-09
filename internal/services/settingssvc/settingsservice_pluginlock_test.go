package settingssvc

import "testing"

func TestPluginLock_RecordsOnConsentAndCompares(t *testing.T) {
	set := newExtensionsHarness(t)
	if len(set.GetPluginLock()) != 0 {
		t.Fatal("fresh lock is not empty")
	}
	// Without a hasher, consent records nothing and every hash matches.
	if err := set.SetPluginAllowed("mill-a", true); err != nil {
		t.Fatal(err)
	}
	if len(set.GetPluginLock()) != 0 || !set.PluginLockMatches("mill-a", "sha256-x") {
		t.Fatal("no hasher: expected no entry and a permissive match")
	}
	set.SetPluginHasher(func(id string) PluginGrantSnapshot {
		if id == "mill-b" {
			return PluginGrantSnapshot{
				Version: "2.0.0", Hash: "sha256-b",
				Capabilities: []string{"open-url"}, Hosts: []string{"api.example.test"},
				Kinds: []string{"views"}, UsesSecrets: true, CanvasHost: true,
			}
		}
		return PluginGrantSnapshot{}
	})
	wrote, err := set.RecordAllowedPluginsIfUnset([]string{"mill-b"})
	if err != nil || wrote {
		t.Fatalf("already recorded: wrote=%v err=%v", wrote, err)
	}
	if err := set.SetPluginAllowed("mill-b", true); err != nil {
		t.Fatal(err)
	}
	if got := set.GetPluginLock()["mill-b"]; got.Version != "2.0.0" || got.Hash != "sha256-b" {
		t.Fatalf("lock = %+v", got)
	}
	if !set.PluginLockMatches("mill-b", "sha256-b") || set.PluginLockMatches("mill-b", "sha256-c") {
		t.Fatal("match compares the recorded hash")
	}
	if !set.PluginLockMatches("mill-b", "") {
		t.Fatal("an unreadable current hash must not revoke consent")
	}
}

// The grant record round-trips the whole capability shape, not just
// the hash -- the baseline widen detection compares a later manifest
// against (docs/goals/0375 S2).
func TestPluginLock_GrantRecordRoundTrips(t *testing.T) {
	set := newExtensionsHarness(t)
	if _, ok := set.PluginGrant("mill-a"); ok {
		t.Fatal("nothing recorded yet")
	}
	set.SetPluginHasher(func(id string) PluginGrantSnapshot {
		return PluginGrantSnapshot{
			Version: "1.0.0", Hash: "sha256-a",
			Capabilities: []string{"open-url", "fetch"}, Hosts: []string{"api.example.test"}, AnyHost: false,
			Kinds: []string{"steps", "views"}, UsesSecrets: true, CanvasHost: true,
		}
	})
	if err := set.SetPluginAllowed("mill-a", true); err != nil {
		t.Fatal(err)
	}
	got, ok := set.PluginGrant("mill-a")
	if !ok {
		t.Fatal("expected a recorded grant")
	}
	want := PluginLockEntry{
		Version: "1.0.0", Hash: "sha256-a",
		Capabilities: []string{"open-url", "fetch"}, Hosts: []string{"api.example.test"},
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
	if _, ok := set.PluginGrant("mill-a"); ok {
		t.Fatal("expected the grant to be forgotten with consent")
	}
}
