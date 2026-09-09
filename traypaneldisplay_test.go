package main

import (
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// screen builds a test *application.Screen whose WorkArea sits offset
// pixels below Bounds.Y (a menu bar) and whose ID is id -- the only
// fields trayPanelPosition reads.
func screen(id string, x, y, width, height int) *application.Screen {
	const menuBarHeight = 24
	return &application.Screen{
		ID:     id,
		Bounds: application.Rect{X: x, Y: y, Width: width, Height: height},
		WorkArea: application.Rect{
			X: x, Y: y + menuBarHeight, Width: width, Height: height - menuBarHeight,
		},
	}
}

// TestTrayPanelPosition_PrimaryLeftSecondaryRight covers the base
// two-display layout: primary at the origin, secondary to its right.
// Wails placed the panel near primary's right edge (offset 6 from
// primary's own edge); the clicked screen is secondary, so the panel
// must land the same 6px from SECONDARY's right edge, at secondary's
// own WorkArea top.
func TestTrayPanelPosition_PrimaryLeftSecondaryRight(t *testing.T) {
	primary := screen("1", 0, 0, 1440, 900)
	secondary := screen("2", 1440, 0, 1920, 1080)
	const w = 340
	placedX, placedY := 1440-6-w, 24+6 // Wails' own placement on primary

	x, y, moved := trayPanelPosition(placedX, placedY, w, primary, secondary, 6)

	if !moved {
		t.Fatal("expected moved=true crossing from primary to secondary")
	}
	wantX := secondary.Bounds.X + secondary.Bounds.Width - 6 - w
	wantY := secondary.WorkArea.Y + 6
	if x != wantX || y != wantY {
		t.Fatalf("got (%d, %d), want (%d, %d)", x, y, wantX, wantY)
	}
}

// TestTrayPanelPosition_SecondaryAbove covers a display arranged ABOVE
// the primary -- negative Y in Mill's normalised top-left-of-primary
// coordinate space (screen_darwin.go's Y flip). Exercises a
// non-default offset (10, not the production 6) to pin that Y is
// genuinely derived from the offset parameter, not a hardcoded
// constant inside trayPanelPosition.
func TestTrayPanelPosition_SecondaryAbove(t *testing.T) {
	primary := screen("1", 0, 0, 1440, 900)
	above := screen("2", 200, -1080, 1920, 1080)
	const w, offset = 340, 10
	placedX, placedY := 1440-6-w, 24+6

	x, y, moved := trayPanelPosition(placedX, placedY, w, primary, above, offset)

	if !moved {
		t.Fatal("expected moved=true onto the display above")
	}
	if y != above.WorkArea.Y+offset {
		t.Fatalf("got y=%d, want %d (above's own WorkArea top, negative)", y, above.WorkArea.Y+offset)
	}
	if y >= 0 {
		t.Fatalf("expected a negative Y for a display above the primary, got %d", y)
	}
	wantX := above.Bounds.X + above.Bounds.Width - 6 - w
	if x != wantX {
		t.Fatalf("got x=%d, want %d", x, wantX)
	}
}

// TestTrayPanelPosition_SecondaryLeft covers a display arranged to the
// LEFT of the primary -- negative X.
func TestTrayPanelPosition_SecondaryLeft(t *testing.T) {
	primary := screen("1", 0, 0, 1440, 900)
	left := screen("2", -1920, 0, 1920, 1080)
	const w = 340
	placedX, placedY := 1440-6-w, 24+6

	x, y, moved := trayPanelPosition(placedX, placedY, w, primary, left, 6)

	if !moved {
		t.Fatal("expected moved=true onto the display to the left")
	}
	wantX := left.Bounds.X + left.Bounds.Width - 6 - w
	if x != wantX || x >= 0 {
		t.Fatalf("got x=%d, want %d (negative, left of the primary)", x, wantX)
	}
	if y != left.WorkArea.Y+6 {
		t.Fatalf("got y=%d, want %d", y, left.WorkArea.Y+6)
	}
}

// TestTrayPanelPosition_ClampsAtRightEdge covers a target screen
// narrower than the rightOffset Wails placed the panel with on a wider
// placedOn screen -- the naive translation would push the panel's
// right edge past target's own right edge; it must clamp to target's
// Bounds instead.
func TestTrayPanelPosition_ClampsAtRightEdge(t *testing.T) {
	placedOn := screen("1", 0, 0, 3000, 1000) // wide
	target := screen("2", 3000, 0, 400, 1000) // narrow
	const w = 340
	// Wails placed the panel with its right edge already past
	// placedOn's own right edge (a negative rightOffset) -- translating
	// that onto a narrower target pushes x past target's right edge.
	placedX, placedY := 2980, 30

	x, _, moved := trayPanelPosition(placedX, placedY, w, placedOn, target, 6)

	if !moved {
		t.Fatal("expected moved=true")
	}
	maxX := target.Bounds.X + target.Bounds.Width - w
	if x != maxX {
		t.Fatalf("got x=%d, want clamped x=%d (target's right edge minus width)", x, maxX)
	}
}

// TestTrayPanelPosition_SameDisplay_NotMoved pins the identity path:
// target and placedOn are the same display, so the function returns
// the original placement unchanged and moved=false -- the caller never
// calls SetPosition on the common single-display case.
func TestTrayPanelPosition_SameDisplay_NotMoved(t *testing.T) {
	primary := screen("1", 0, 0, 1440, 900)
	const w = 340
	placedX, placedY := 1440-6-w, 30

	x, y, moved := trayPanelPosition(placedX, placedY, w, primary, primary, 6)

	if moved {
		t.Fatal("expected moved=false on the same display")
	}
	if x != placedX || y != placedY {
		t.Fatalf("got (%d, %d), want the unchanged placement (%d, %d)", x, y, placedX, placedY)
	}
}
