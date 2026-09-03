package settingssvc

import "testing"

func TestCaptureDestinations_RememberPerKey(t *testing.T) {
	set := newExtensionsHarness(t)
	if len(set.GetCaptureDestinations()) != 0 {
		t.Fatal("fresh destinations not empty")
	}
	if err := set.SetCaptureDestination("note", "atlas-card-scratchpad"); err != nil {
		t.Fatal(err)
	}
	if err := set.SetCaptureDestination("mill-clipper/clip", ""); err != nil {
		t.Fatal(err)
	}
	if err := set.SetCaptureDestination(" ", "ignored"); err != nil {
		t.Fatal(err)
	}
	got := set.GetCaptureDestinations()
	if got["note"] != "atlas-card-scratchpad" || len(got) != 2 {
		t.Fatalf("destinations = %v", got)
	}
	if v, ok := got["mill-clipper/clip"]; !ok || v != "" {
		t.Fatalf("top-level destination lost: %v", got)
	}
	// ShowCapture with no window wired only emits; it must not panic.
	set.ShowCapture("", "note")
	set.HideCapture()
}
