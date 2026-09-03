package settingssvc

import (
	"reflect"
	"testing"
)

func TestPluginTrust_AllowedRoundTripsAndWithdraws(t *testing.T) {
	set := newExtensionsHarness(t)
	if got := set.GetAllowedPlugins(); len(got) != 0 {
		t.Fatalf("unset = %v, want empty", got)
	}
	if err := set.SetPluginAllowed("mill-a", true); err != nil {
		t.Fatal(err)
	}
	if err := set.SetPluginAllowed("mill-b", true); err != nil {
		t.Fatal(err)
	}
	if err := set.SetPluginAllowed("mill-a", true); err != nil { // idempotent
		t.Fatal(err)
	}
	if got := set.GetAllowedPlugins(); !reflect.DeepEqual(got, []string{"mill-b", "mill-a"}) {
		t.Fatalf("allowed = %v, want [mill-b mill-a]", got)
	}
	if err := set.SetPluginAllowed("mill-b", false); err != nil {
		t.Fatal(err)
	}
	if got := set.GetAllowedPlugins(); !reflect.DeepEqual(got, []string{"mill-a"}) {
		t.Fatalf("after withdraw = %v, want [mill-a]", got)
	}
}

// Grandfathering writes once: an unset instance records what is
// present; a recorded set (even an empty one) is never overwritten.
func TestPluginTrust_RecordAllowedPluginsIfUnset_WritesOnce(t *testing.T) {
	set := newExtensionsHarness(t)
	wrote, err := set.RecordAllowedPluginsIfUnset([]string{"mill-a", "mill-b"})
	if err != nil || !wrote {
		t.Fatalf("first record: wrote=%v err=%v, want true/nil", wrote, err)
	}
	wrote, err = set.RecordAllowedPluginsIfUnset([]string{"mill-c"})
	if err != nil || wrote {
		t.Fatalf("second record: wrote=%v err=%v, want false/nil", wrote, err)
	}
	if got := set.GetAllowedPlugins(); !reflect.DeepEqual(got, []string{"mill-a", "mill-b"}) {
		t.Fatalf("allowed = %v, want the first write kept", got)
	}

	fresh := newExtensionsHarness(t)
	if err := fresh.SetPluginAllowed("x", false); err != nil { // records an EMPTY set
		t.Fatal(err)
	}
	wrote, _ = fresh.RecordAllowedPluginsIfUnset([]string{"mill-a"})
	if wrote {
		t.Fatal("an explicitly empty allowed set was treated as unset")
	}
}

func TestPluginTrust_AllowlistReadsPolicy(t *testing.T) {
	set := newExtensionsHarness(t)
	if got := set.GetPluginAllowlist(); len(got) != 0 {
		t.Fatalf("no policy = %v, want empty", got)
	}
	if err := set.store.Set(pluginAllowlistKey, `["mill-bookmark"]`); err != nil {
		t.Fatal(err)
	}
	if got := set.GetPluginAllowlist(); !reflect.DeepEqual(got, []string{"mill-bookmark"}) {
		t.Fatalf("policy = %v, want [mill-bookmark]", got)
	}
	if err := set.store.Set(pluginAllowlistKey, `not json`); err != nil {
		t.Fatal(err)
	}
	if got := set.GetPluginAllowlist(); len(got) != 0 {
		t.Fatalf("corrupt policy = %v, want empty: an unreadable policy is no policy, and the row states it", got)
	}
}
