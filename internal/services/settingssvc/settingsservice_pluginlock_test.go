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
	set.SetPluginHasher(func(id string) (string, string) {
		if id == "mill-b" {
			return "2.0.0", "sha256-b"
		}
		return "", ""
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
