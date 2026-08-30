package settingssvc

import "testing"

func TestGetSeenFirstRunIntros_UnsetReturnsEmpty(t *testing.T) {
	set := newExtensionsHarness(t)
	if got := set.GetSeenFirstRunIntros(); len(got) != 0 {
		t.Errorf("GetSeenFirstRunIntros(unset) = %v, want empty", got)
	}
}

func TestMarkFirstRunIntroSeen_RoundTripsAndStaysIdempotent(t *testing.T) {
	set := newExtensionsHarness(t)
	if err := set.MarkFirstRunIntroSeen("secrets"); err != nil {
		t.Fatalf("MarkFirstRunIntroSeen: %v", err)
	}
	if err := set.MarkFirstRunIntroSeen("secrets"); err != nil {
		t.Fatalf("MarkFirstRunIntroSeen (repeat): %v", err)
	}
	if err := set.MarkFirstRunIntroSeen("remote"); err != nil {
		t.Fatalf("MarkFirstRunIntroSeen (second id): %v", err)
	}
	got := set.GetSeenFirstRunIntros()
	if len(got) != 2 || got[0] != "secrets" || got[1] != "remote" {
		t.Errorf("GetSeenFirstRunIntros() = %v, want [secrets remote]", got)
	}
}
