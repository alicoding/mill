package settingssvc

import "testing"

func TestGetExtensionSettings_UnsetReturnsEmpty(t *testing.T) {
	set := newExtensionsHarness(t)
	got := set.GetExtensionSettings()
	if got == nil || len(got) != 0 {
		t.Errorf("GetExtensionSettings(unset) = %v, want empty map", got)
	}
}

func TestSetExtensionSetting_RoundTripsPerExtensionPerKey(t *testing.T) {
	set := newExtensionsHarness(t)
	if err := set.SetExtensionSetting("note", "richCodeBlocks", true); err != nil {
		t.Fatalf("SetExtensionSetting: %v", err)
	}
	if err := set.SetExtensionSetting("note", "somethingElse", false); err != nil {
		t.Fatalf("SetExtensionSetting second key: %v", err)
	}
	if err := set.SetExtensionSetting("diagram", "richCodeBlocks", false); err != nil {
		t.Fatalf("SetExtensionSetting second extension: %v", err)
	}
	got := set.GetExtensionSettings()
	if v := got["note"]["richCodeBlocks"]; !v {
		t.Errorf("note.richCodeBlocks = %v, want true", v)
	}
	if v, ok := got["note"]["somethingElse"]; !ok || v {
		t.Errorf("note.somethingElse = %v (present %v), want stored false", v, ok)
	}
	if v, ok := got["diagram"]["richCodeBlocks"]; !ok || v {
		t.Errorf("diagram.richCodeBlocks = %v (present %v), want stored false", v, ok)
	}
}

func TestSetExtensionSetting_OverwriteWins(t *testing.T) {
	set := newExtensionsHarness(t)
	if err := set.SetExtensionSetting("note", "richCodeBlocks", true); err != nil {
		t.Fatalf("SetExtensionSetting: %v", err)
	}
	if err := set.SetExtensionSetting("note", "richCodeBlocks", false); err != nil {
		t.Fatalf("SetExtensionSetting overwrite: %v", err)
	}
	if v := set.GetExtensionSettings()["note"]["richCodeBlocks"]; v {
		t.Errorf("after overwrite, note.richCodeBlocks = %v, want false", v)
	}
}
