package seedorigin

import "testing"

func TestTouch_LatchesModifiedOnlyForSeededOrigin(t *testing.T) {
	seeded := Origin{SeedRevision: 1, Modified: false}
	if got := seeded.Touch(); !got.Modified {
		t.Errorf("Touch() on a seeded, unmodified Origin = %+v, want Modified true", got)
	}

	notSeeded := Origin{}
	if got := notSeeded.Touch(); got.Modified {
		t.Errorf("Touch() on a non-seeded Origin (SeedRevision 0) = %+v, want left untouched (Modified false)", got)
	}
	if got := notSeeded.Touch(); got.SeedRevision != 0 {
		t.Errorf("Touch() on a non-seeded Origin must not stamp a revision, got %+v", got)
	}
}

func TestTouch_IsOneWay(t *testing.T) {
	o := Origin{SeedRevision: 3, Modified: true}
	if got := o.Touch(); !got.Modified {
		t.Errorf("Touch() on an already-Modified Origin = %+v, want still Modified", got)
	}
}

func TestStamp_ReturnsUnmodifiedAtRevision(t *testing.T) {
	got := Stamp(5)
	if got.SeedRevision != 5 || got.Modified {
		t.Errorf("Stamp(5) = %+v, want {5 false}", got)
	}
}

func TestIsSeeded(t *testing.T) {
	if (Origin{}).IsSeeded() {
		t.Error("zero-value Origin.IsSeeded() = true, want false")
	}
	if !(Origin{SeedRevision: 1}).IsSeeded() {
		t.Error("Origin{SeedRevision: 1}.IsSeeded() = false, want true")
	}
}
