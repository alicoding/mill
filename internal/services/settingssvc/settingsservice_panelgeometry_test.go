package settingssvc

import (
	"testing"
	"time"

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

// TestPersistPanelGeometry_ReclampsThroughLiveClamp pins the other half
// of the regression fix: a move that WOULD land off the live screen
// layout is re-clamped before it's ever written, not just at show time
// (settingsservice_panelgeometry.go's WatchPanelGeometry doc comment).
func TestPersistPanelGeometry_ReclampsThroughLiveClamp(t *testing.T) {
	s := newTestSettingsService(t)
	s.SetPanelPositionClamp(func(x, y int) (int, int) { return x + 1000, y + 2000 })

	s.persistPanelGeometry(windowGeometry{X: 10, Y: 20})

	x, y, ok := s.LoadPanelGeometry()
	if !ok {
		t.Fatal("LoadPanelGeometry() after persisting returned ok=false")
	}
	if x != 1010 || y != 2020 {
		t.Errorf("LoadPanelGeometry() = (%d, %d), want the CLAMPED (1010, 2020)", x, y)
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

// fakePanelWindow implements floatingWindow (settingsservice_presence.go)
// -- presentPanelShow's own fake-testable half, per that function's doc
// comment: records Show/Focus/SetPosition/Center in the exact order
// they happen, with no live OS window.
type fakePanelWindow struct {
	calls      []string
	setX, setY int
}

func (f *fakePanelWindow) Show()  { f.calls = append(f.calls, "Show") }
func (f *fakePanelWindow) Focus() { f.calls = append(f.calls, "Focus") }
func (f *fakePanelWindow) SetPosition(x, y int) {
	f.calls = append(f.calls, "SetPosition")
	f.setX, f.setY = x, y
}
func (f *fakePanelWindow) Center() { f.calls = append(f.calls, "Center") }

func (f *fakePanelWindow) callOrderEquals(want []string) bool {
	if len(f.calls) != len(want) {
		return false
	}
	for i, c := range f.calls {
		if c != want[i] {
			return false
		}
	}
	return true
}

// TestPresentPanelShow_SavedPosition_SetsClampedPositionBeforeShow pins
// the regression's own fix: the saved position, run through the live
// clamp, lands via SetPosition strictly BEFORE Show/Focus -- construction-
// time InitialPosition alone was never enough (this file's package doc).
func TestPresentPanelShow_SavedPosition_SetsClampedPositionBeforeShow(t *testing.T) {
	f := &fakePanelWindow{}
	clamp := func(x, y int) (int, int) { return x + 1, y + 2 }

	presentPanelShow(f, 100, 200, true, clamp)

	if f.setX != 101 || f.setY != 202 {
		t.Errorf("SetPosition(%d, %d), want the CLAMPED (101, 202)", f.setX, f.setY)
	}
	want := []string{"SetPosition", "Show", "Focus"}
	if !f.callOrderEquals(want) {
		t.Errorf("call order = %v, want %v -- SetPosition must land before Show", f.calls, want)
	}
}

// TestPresentPanelShow_NoSavedPosition_Centers covers first run/no
// saved position: Center(), never SetPosition, still before Show.
func TestPresentPanelShow_NoSavedPosition_Centers(t *testing.T) {
	f := &fakePanelWindow{}

	presentPanelShow(f, 999, 999, false, nil)

	want := []string{"Center", "Show", "Focus"}
	if !f.callOrderEquals(want) {
		t.Errorf("call order = %v, want %v -- no saved position must Center, never SetPosition", f.calls, want)
	}
}

// TestShouldPersistPanelMove covers the placement-grace guard's full
// input space: hidden never persists regardless of timing, visible
// within the grace window is the window manager's own post-show
// settling move (not a user drag), visible past it is.
func TestShouldPersistPanelMove(t *testing.T) {
	cases := []struct {
		name      string
		visible   bool
		sinceShow time.Duration
		want      bool
	}{
		{"hidden -- never persisted regardless of timing", false, time.Second, false},
		{"hidden and within the placement grace -- still not persisted", false, 50 * time.Millisecond, false},
		{"visible but within the placement grace -- window manager's own settling move", true, 100 * time.Millisecond, false},
		{"visible at exactly the grace boundary -- persisted", true, panelGeometryPlacementGrace, true},
		{"visible and past the placement grace -- a real user drag", true, 500 * time.Millisecond, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := shouldPersistPanelMove(tc.visible, tc.sinceShow)
			if got != tc.want {
				t.Errorf("shouldPersistPanelMove(visible=%v, sinceShow=%v) = %v, want %v", tc.visible, tc.sinceShow, got, tc.want)
			}
		})
	}
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
