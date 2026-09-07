package settingssvc

import (
	"testing"

	"github.com/alicoding/mill/internal/services/dataevent"
)

// Quick Panel position persistence (goal 0377) -- WatchPanelGeometry
// and ResetPanelPosition's own p.Center() call both need a real
// *application.WebviewWindow (no headless run loop in CI, same class
// of gap settingsservice_windowgeometry.go's own test file already
// notes for the main window); these tests cover the headless-testable
// pure-logic half: LoadPanelGeometry/persistPanelGeometry/
// clearPanelGeometry's persist/restore/clear round trip, the
// mill-data-changed announcement, and ClampPanelPosition's math.

func TestLoadPanelGeometry_NothingPersisted_ReturnsNotOK(t *testing.T) {
	s := newTestSettingsService(t)
	if _, _, ok := s.LoadPanelGeometry(); ok {
		t.Error("LoadPanelGeometry() on a fresh service returned ok=true, want false")
	}
	if s.HasCustomPanelPosition() {
		t.Error("HasCustomPanelPosition() on a fresh service returned true, want false")
	}
}

func TestPersistAndLoadPanelGeometry_RoundTrips(t *testing.T) {
	s := newTestSettingsService(t)

	s.persistPanelGeometry(windowGeometry{X: 300, Y: 150, Width: quickPanelWidthForTest, Height: quickPanelHeightForTest})

	x, y, ok := s.LoadPanelGeometry()
	if !ok {
		t.Fatal("LoadPanelGeometry() after persisting a position returned ok=false")
	}
	if x != 300 || y != 150 {
		t.Errorf("LoadPanelGeometry() = (%d, %d), want (300, 150)", x, y)
	}
	if !s.HasCustomPanelPosition() {
		t.Error("HasCustomPanelPosition() after persisting a position returned false, want true")
	}
}

func TestClearPanelGeometry_ClearsSavedPosition(t *testing.T) {
	s := newTestSettingsService(t)
	s.persistPanelGeometry(windowGeometry{X: 300, Y: 150})
	if !s.HasCustomPanelPosition() {
		t.Fatal("setup: HasCustomPanelPosition() = false after persisting, want true")
	}

	s.clearPanelGeometry()

	if s.HasCustomPanelPosition() {
		t.Error("HasCustomPanelPosition() after clearPanelGeometry() = true, want false")
	}
	if _, _, ok := s.LoadPanelGeometry(); ok {
		t.Error("LoadPanelGeometry() after clearPanelGeometry() returned ok=true, want false")
	}
}

func TestResetPanelPosition_NilPanel_DoesNotPanic(t *testing.T) {
	s := newTestSettingsService(t)
	s.ResetPanelPosition() // SetPanelWindow was never called -- must not panic.
}

// captureQuickPanelPositionEmits mirrors compositionservice_dataevent_
// test.go's own captureEmits: application.Get() is always nil under `go
// test`, so dataevent.TestHook is the one seam that can observe an Emit
// call at all.
func captureQuickPanelPositionEmits(t *testing.T) *[]dataevent.Changed {
	t.Helper()
	var got []dataevent.Changed
	dataevent.TestHook = func(entity, id string) {
		got = append(got, dataevent.Changed{Entity: entity, ID: id})
	}
	t.Cleanup(func() { dataevent.TestHook = nil })
	return &got
}

func TestDataEvent_PanelGeometryChanges(t *testing.T) {
	s := newTestSettingsService(t)

	t.Run("persistPanelGeometry", func(t *testing.T) {
		got := captureQuickPanelPositionEmits(t)
		s.persistPanelGeometry(windowGeometry{X: 10, Y: 20})
		assertEmittedQuickPanelPosition(t, *got)
	})

	t.Run("clearPanelGeometry", func(t *testing.T) {
		got := captureQuickPanelPositionEmits(t)
		s.clearPanelGeometry()
		assertEmittedQuickPanelPosition(t, *got)
	})
}

func assertEmittedQuickPanelPosition(t *testing.T, got []dataevent.Changed) {
	t.Helper()
	for _, c := range got {
		if c.Entity == "quickpanel-position" {
			return
		}
	}
	t.Errorf("mill-data-changed emits = %+v, want one with entity=quickpanel-position", got)
}

// quickPanelWidthForTest/quickPanelHeightForTest stand in for
// auxwindows.go's own quickPanelWidth/quickPanelHeight constants (the
// main package, unreachable from this one) -- only their non-zero-ness
// matters to the round-trip test above.
const quickPanelWidthForTest, quickPanelHeightForTest = 560, 400

// TestClampPanelPosition covers ClampPanelPosition's table: fully
// inside a screen (unchanged), partly off (clamped into the screen it
// mostly overlaps), fully off every screen (clamped into primary), and
// a multi-screen layout where the position belongs on the SECOND
// screen, not primary.
func TestClampPanelPosition(t *testing.T) {
	primary := Rect{X: 0, Y: 0, Width: 1440, Height: 900}
	secondary := Rect{X: 1440, Y: 0, Width: 1920, Height: 1080}

	cases := []struct {
		name          string
		x, y          int
		width, height int
		screens       []Rect
		primary       Rect
		wantX, wantY  int
	}{
		{
			name: "fully inside primary -- unchanged",
			x:    400, y: 300, width: 560, height: 400,
			screens: []Rect{primary}, primary: primary,
			wantX: 400, wantY: 300,
		},
		{
			// Center at x=1400 with width 560 spans 1120..1680 -- mostly
			// off primary's 0..1440 (only 1120..1440, 320px, is on
			// primary; the rest hangs off the right edge into nothing),
			// well under 50% of the panel's own 560px width.
			name: "mostly off every screen -- clamped into primary",
			x:    1400, y: 300, width: 560, height: 400,
			screens: []Rect{primary}, primary: primary,
			wantX: 1440 - 560 - 16, wantY: 300,
		},
		{
			name: "fully off every screen -- clamped into primary",
			x:    50000, y: 50000, width: 560, height: 400,
			screens: []Rect{primary}, primary: primary,
			wantX: 1440 - 560 - 16, wantY: 900 - 400 - 16,
		},
		{
			name: "multi-screen: mostly on the SECONDARY screen, not primary",
			x:    1500, y: 200, width: 560, height: 400,
			screens: []Rect{primary, secondary}, primary: primary,
			// x=1500..2060 overlaps secondary (1440..3360) across its
			// full 560px width -- 100% overlap, so this case actually
			// stays unchanged (it's fully on the secondary screen).
			wantX: 1500, wantY: 200,
		},
		{
			name:    "no screens known at all -- position left unchanged",
			x:       777, y: 888, width: 560, height: 400,
			screens: nil, primary: Rect{},
			wantX: 777, wantY: 888,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			gotX, gotY := ClampPanelPosition(c.x, c.y, c.width, c.height, c.screens, c.primary)
			if gotX != c.wantX || gotY != c.wantY {
				t.Errorf("ClampPanelPosition(%d, %d, %d, %d, %v, %v) = (%d, %d), want (%d, %d)",
					c.x, c.y, c.width, c.height, c.screens, c.primary, gotX, gotY, c.wantX, c.wantY)
			}
		})
	}
}
