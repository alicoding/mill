package settingssvc

import (
	"strings"
	"testing"
)

func TestPluginStorage_RoundTripsAnyJSONPerPluginPerKey(t *testing.T) {
	set := newExtensionsHarness(t)
	writes := []struct{ plugin, key, value string }{
		{"mill-drawing", "pencil", `{"color":"#da3633","size":4}`},
		{"mill-drawing", "shape", `{"kind":"circle"}`},
		{"mill-bookmark", "recent", `["a","b"]`},
		{"mill-bookmark", "count", `3`},
		{"mill-bookmark", "flag", `true`},
	}
	for _, w := range writes {
		if err := set.SetPluginStorageValue(w.plugin, w.key, w.value); err != nil {
			t.Fatalf("SetPluginStorageValue(%s.%s): %v", w.plugin, w.key, err)
		}
	}
	got := set.GetPluginStorage()
	for _, w := range writes {
		if v, ok := got[w.plugin][w.key]; !ok || v != w.value {
			t.Errorf("%s.%s = %q (present %v), want %q", w.plugin, w.key, v, ok, w.value)
		}
	}
	if len(got) != 2 {
		t.Errorf("plugins stored = %d, want 2", len(got))
	}
}

func TestPluginStorage_UnsetIsEmptyNeverNil(t *testing.T) {
	set := newExtensionsHarness(t)
	if got := set.GetPluginStorage(); got == nil || len(got) != 0 {
		t.Errorf("GetPluginStorage(unset) = %v, want empty map", got)
	}
}

func TestPluginStorage_DeleteRemovesKeyAndEmptyPlugin(t *testing.T) {
	set := newExtensionsHarness(t)
	if err := set.SetPluginStorageValue("p", "a", `1`); err != nil {
		t.Fatal(err)
	}
	if err := set.SetPluginStorageValue("p", "b", `2`); err != nil {
		t.Fatal(err)
	}
	if err := set.DeletePluginStorageValue("p", "a"); err != nil {
		t.Fatal(err)
	}
	if _, present := set.GetPluginStorage()["p"]["a"]; present {
		t.Error("deleted key still present")
	}
	if err := set.DeletePluginStorageValue("p", "b"); err != nil {
		t.Fatal(err)
	}
	if _, present := set.GetPluginStorage()["p"]; present {
		t.Error("plugin with no keys left still present")
	}
	// Deleting what isn't there is a quiet success.
	if err := set.DeletePluginStorageValue("nobody", "nothing"); err != nil {
		t.Errorf("delete of absent key errored: %v", err)
	}
}

// Fail-closed at the door: a bad key, invalid JSON, or a JSON null
// (which would masquerade as "absent") is refused, blob untouched.
func TestPluginStorage_RefusesBadKeysAndValues(t *testing.T) {
	set := newExtensionsHarness(t)
	if err := set.SetPluginStorageValue("p", "bad key", `1`); err == nil || !strings.Contains(err.Error(), "storage key") {
		t.Errorf("bad key error = %v", err)
	}
	for _, bad := range []string{`{not json`, ``, `null`} {
		if err := set.SetPluginStorageValue("p", "k", bad); err == nil || !strings.Contains(err.Error(), "valid JSON") {
			t.Errorf("SetPluginStorageValue(%q) error = %v, want the JSON refusal", bad, err)
		}
	}
	if got := set.GetPluginStorage(); len(got) != 0 {
		t.Errorf("blob touched by refused writes: %v", got)
	}
}

func TestPluginStorage_CanonicalizesTheLiteral(t *testing.T) {
	set := newExtensionsHarness(t)
	if err := set.SetPluginStorageValue("p", "k", ` { "a" : 1 } `); err != nil {
		t.Fatal(err)
	}
	if v := set.GetPluginStorage()["p"]["k"]; v != `{"a":1}` {
		t.Errorf("stored %q, want compact", v)
	}
}
