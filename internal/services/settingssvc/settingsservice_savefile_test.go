package settingssvc

import (
	"log/slog"
	"testing"

	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/alicoding/mill/internal/services/triggersvc"
)

// TestSaveTextFile_NoLiveApplicationErrors: a headless `go test` run
// never calls application.New, so application.Get() is nil -- the same
// condition revealPath (atlasservice_share.go) treats as a silent
// no-op. SaveTextFile must instead report a real error rather than
// panic on the nil app, since a caller cannot tell "cancelled" apart
// from "never ran" without one.
func TestSaveTextFile_NoLiveApplicationErrors(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	path, err := set.SaveTextFile("export.json", `{"a":1}`)
	if err == nil {
		t.Fatal("SaveTextFile() with no live application: want an error, got nil")
	}
	if path != "" {
		t.Errorf("SaveTextFile() path = %q, want empty on error", path)
	}
}
