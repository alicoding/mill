package settingssvc

import "testing"

func TestPreferredLinkPasteKind_UnsetIsEmpty(t *testing.T) {
	set := newExtensionsHarness(t)
	if got := set.GetPreferredLinkPasteKind(); got != "" {
		t.Errorf("GetPreferredLinkPasteKind(unset) = %q, want empty", got)
	}
}

func TestPreferredLinkPasteKind_RoundTripsAndClears(t *testing.T) {
	set := newExtensionsHarness(t)
	if err := set.SetPreferredLinkPasteKind(" clip "); err != nil {
		t.Fatal(err)
	}
	if got := set.GetPreferredLinkPasteKind(); got != "clip" {
		t.Errorf("after set = %q, want the trimmed kind", got)
	}
	if err := set.SetPreferredLinkPasteKind(""); err != nil {
		t.Fatal(err)
	}
	if got := set.GetPreferredLinkPasteKind(); got != "" {
		t.Errorf("after clear = %q, want empty", got)
	}
}
