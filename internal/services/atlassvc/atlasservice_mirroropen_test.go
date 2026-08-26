package atlassvc

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
)

// TestOpenObjectMirrorInDefaultApp_UnknownObject_Errors and its two
// siblings below mirror atlasservice_share_test.go's own
// TestOpenCardMirror_* trio -- the board-object door adds one more
// case (a mirrorPath naming a file that no longer exists) that the
// card door doesn't check at all (this file's own header comment on
// OpenObjectMirrorInDefaultApp explains why the two doors diverge
// there).
func TestOpenObjectMirrorInDefaultApp_UnknownObject_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	if err := a.OpenObjectMirrorInDefaultApp("does-not-exist"); err == nil {
		t.Error("OpenObjectMirrorInDefaultApp(unknown id) = nil error, want an error")
	}
}

func TestOpenObjectMirrorInDefaultApp_NoMirrorPath_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	o, err := a.CreateBoardObject("shape", map[string]string{"shapeType": "rectangle"}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	if err := a.OpenObjectMirrorInDefaultApp(o.ID); err == nil {
		t.Error("OpenObjectMirrorInDefaultApp on an object with no mirrorPath = nil error, want an error")
	}
}

func TestOpenObjectMirrorInDefaultApp_FileVanished_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	path := filepath.Join(t.TempDir(), "flow.drawio")
	if err := os.WriteFile(path, []byte("<mxfile></mxfile>"), 0o600); err != nil {
		t.Fatal(err)
	}
	o, err := a.CreateBoardObject("diagram", map[string]string{"mirrorPath": path}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := a.OpenObjectMirrorInDefaultApp(o.ID); err == nil {
		t.Error("OpenObjectMirrorInDefaultApp on a vanished mirror = nil error, want an error")
	}
}

// TestOpenObjectMirrorInDefaultApp_HeadlessNoLiveApp_NoOp proves the
// success path never actually shells out under `go test` (no live
// Wails application, windowing.Available() false) -- the same headless
// guard TestOpenCardMirror_HeadlessNoLiveApp_NoOp already pins for the
// card door.
func TestOpenObjectMirrorInDefaultApp_HeadlessNoLiveApp_NoOp(t *testing.T) {
	a := newTestAtlasService(t)
	path := filepath.Join(t.TempDir(), "flow.drawio")
	if err := os.WriteFile(path, []byte("<mxfile></mxfile>"), 0o600); err != nil {
		t.Fatal(err)
	}
	o, err := a.CreateBoardObject("diagram", map[string]string{"mirrorPath": path}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	if err := a.OpenObjectMirrorInDefaultApp(o.ID); err != nil {
		t.Errorf("OpenObjectMirrorInDefaultApp headless = %v, want nil (no live app to shell out to)", err)
	}
}
