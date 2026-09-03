package settingssvc

import (
	"strings"
	"testing"
)

func TestGetExtensionSettings_UnsetReturnsEmpty(t *testing.T) {
	set := newExtensionsHarness(t)
	got := set.GetExtensionSettings()
	if got == nil || len(got) != 0 {
		t.Errorf("GetExtensionSettings(unset) = %v, want empty map", got)
	}
}

func TestSetExtensionSetting_RoundTripsEveryScalarTypePerExtensionPerKey(t *testing.T) {
	set := newExtensionsHarness(t)
	writes := []struct{ ext, key, value string }{
		{"note", "richCodeBlocks", "true"},
		{"note", "somethingElse", "false"},
		{"sheet", "previewRows", "25"},
		{"mill-bookmark", "titleStyle", `"hostname"`},
		{"mill-bookmark", "placeholderTitle", `"My link"`},
	}
	for _, w := range writes {
		if err := set.SetExtensionSetting(w.ext, w.key, w.value); err != nil {
			t.Fatalf("SetExtensionSetting(%s.%s): %v", w.ext, w.key, err)
		}
	}
	got := set.GetExtensionSettings()
	for _, w := range writes {
		if v, ok := got[w.ext][w.key]; !ok || v != w.value {
			t.Errorf("%s.%s = %q (present %v), want %q", w.ext, w.key, v, ok, w.value)
		}
	}
}

func TestSetExtensionSetting_OverwriteWins(t *testing.T) {
	set := newExtensionsHarness(t)
	if err := set.SetExtensionSetting("note", "richCodeBlocks", "true"); err != nil {
		t.Fatalf("SetExtensionSetting: %v", err)
	}
	if err := set.SetExtensionSetting("note", "richCodeBlocks", "false"); err != nil {
		t.Fatalf("SetExtensionSetting overwrite: %v", err)
	}
	if v := set.GetExtensionSettings()["note"]["richCodeBlocks"]; v != "false" {
		t.Errorf("after overwrite, note.richCodeBlocks = %q, want \"false\"", v)
	}
}

// A blob written by the booleans-only first slice (bare true/false
// per key) reads back unchanged through the typed store -- no
// migration step exists, so the format must be a superset.
func TestGetExtensionSettings_ReadsTheBooleansOnlyBlobUnchanged(t *testing.T) {
	set := newExtensionsHarness(t)
	if err := set.store.Set(extensionSettingsKey, `{"note":{"richCodeBlocks":true}}`); err != nil {
		t.Fatal(err)
	}
	if v := set.GetExtensionSettings()["note"]["richCodeBlocks"]; v != "true" {
		t.Errorf("legacy blob read back %q, want \"true\"", v)
	}
}

// Fail-closed: only JSON scalars are settings. An object, an array,
// null, or non-JSON is refused and the blob stays untouched.
func TestSetExtensionSetting_RefusesNonScalars(t *testing.T) {
	set := newExtensionsHarness(t)
	for _, bad := range []string{`{"a":1}`, `[1,2]`, `null`, `not json`, ``} {
		err := set.SetExtensionSetting("note", "k", bad)
		if err == nil || !strings.Contains(err.Error(), "JSON boolean, string, or number") {
			t.Errorf("SetExtensionSetting(%q) error = %v, want the scalar refusal", bad, err)
		}
	}
	if got := set.GetExtensionSettings(); len(got) != 0 {
		t.Errorf("blob touched by refused writes: %v", got)
	}
}

// Whitespace in a caller's literal never reaches the blob: the stored
// form is canonical.
func TestSetExtensionSetting_CanonicalizesTheLiteral(t *testing.T) {
	set := newExtensionsHarness(t)
	if err := set.SetExtensionSetting("sheet", "previewRows", "  25 "); err != nil {
		t.Fatal(err)
	}
	if v := set.GetExtensionSettings()["sheet"]["previewRows"]; v != "25" {
		t.Errorf("stored %q, want \"25\"", v)
	}
}
