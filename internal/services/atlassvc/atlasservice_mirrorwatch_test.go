package atlassvc

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
)

// waitForMirrorChange blocks on ch for a fired id, failing the test if
// nothing arrives within a generous window -- fsnotify + a real 500ms
// debounce means this is genuinely timing-bound, not instant, the same
// posture filewatch_test.go's own 2-second wait already takes.
func waitForMirrorChange(t *testing.T, ch <-chan string, want string) {
	t.Helper()
	select {
	case got := <-ch:
		if got != want {
			t.Errorf("mirror-changed fired for id %q, want %q", got, want)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("mirror-changed never fired for id %q", want)
	}
}

// assertNoMirrorChange fails if anything arrives on ch within a window
// generous enough that a real (undesired) fire would have shown up --
// proving a closed/disarmed binding truly stopped watching, not just
// that this particular assertion ran before a slow fire landed.
func assertNoMirrorChange(t *testing.T, ch <-chan string) {
	t.Helper()
	select {
	case got := <-ch:
		t.Errorf("mirror-changed fired for id %q, want no event", got)
	case <-time.After(1500 * time.Millisecond):
	}
}

// hookChannel wires MirrorWatchTestHook to a buffered channel for the
// duration of one test -- the seam every test in this file uses since
// windowing.Emit is a no-op under `go test` (no live Wails application).
func hookChannel(t *testing.T) <-chan string {
	t.Helper()
	ch := make(chan string, 8)
	MirrorWatchTestHook = func(id string) { ch <- id }
	t.Cleanup(func() { MirrorWatchTestHook = nil })
	return ch
}

func TestMirrorWatch_ArmedOnCreate_FiresOnExternalWrite(t *testing.T) {
	a := newTestAtlasService(t)
	ch := hookChannel(t)
	path := filepath.Join(t.TempDir(), "flow.drawio")
	if err := os.WriteFile(path, []byte("<mxfile></mxfile>"), 0o600); err != nil {
		t.Fatal(err)
	}
	o, err := a.CreateBoardObject("diagram", map[string]string{"mirrorPath": path}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	if err := os.WriteFile(path, []byte("<mxfile><diagram/></mxfile>"), 0o600); err != nil {
		t.Fatal(err)
	}
	waitForMirrorChange(t, ch, o.ID)
}

// A non-diagram mirror (e.g. a plain .md card) is never watched --
// armMirrorWatch's own extension gate, proven by writing to the file
// and confirming no event ever fires.
func TestMirrorWatch_NonDiagramExtension_NeverArmed(t *testing.T) {
	a := newTestAtlasService(t)
	ch := hookChannel(t)
	c := newMirroredCard(t, a, "notes.md", "# Title")

	if err := os.WriteFile(c.MirrorPath, []byte("# Changed"), 0o600); err != nil {
		t.Fatal(err)
	}
	assertNoMirrorChange(t, ch)
}

func TestMirrorWatch_Debounces_BurstOfWritesFiresOnce(t *testing.T) {
	a := newTestAtlasService(t)
	ch := hookChannel(t)
	path := filepath.Join(t.TempDir(), "flow.drawio")
	if err := os.WriteFile(path, []byte("<mxfile></mxfile>"), 0o600); err != nil {
		t.Fatal(err)
	}
	o, err := a.CreateBoardObject("diagram", map[string]string{"mirrorPath": path}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	for i := 0; i < 5; i++ {
		if err := os.WriteFile(path, []byte("<mxfile><diagram/></mxfile>"), 0o600); err != nil {
			t.Fatal(err)
		}
		time.Sleep(50 * time.Millisecond)
	}
	waitForMirrorChange(t, ch, o.ID)
	// Nothing further -- the burst above coalesced into exactly one fire.
	assertNoMirrorChange(t, ch)
}

func TestMirrorWatch_ClosedOnDelete_NoFurtherEvents(t *testing.T) {
	a := newTestAtlasService(t)
	ch := hookChannel(t)
	path := filepath.Join(t.TempDir(), "flow.drawio")
	if err := os.WriteFile(path, []byte("<mxfile></mxfile>"), 0o600); err != nil {
		t.Fatal(err)
	}
	o, err := a.CreateBoardObject("diagram", map[string]string{"mirrorPath": path}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	if _, err := a.DeleteBoardObject(o.ID); err != nil {
		t.Fatalf("DeleteBoardObject: %v", err)
	}

	if err := os.WriteFile(path, []byte("<mxfile><diagram/></mxfile>"), 0o600); err != nil {
		t.Fatal(err)
	}
	assertNoMirrorChange(t, ch)
}

func TestMirrorWatch_ClosedOnShutdown_NoFurtherEvents(t *testing.T) {
	a := newTestAtlasService(t)
	ch := hookChannel(t)
	path := filepath.Join(t.TempDir(), "flow.drawio")
	if err := os.WriteFile(path, []byte("<mxfile></mxfile>"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := a.CreateBoardObject("diagram", map[string]string{"mirrorPath": path}, atlas.Position{}, ""); err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	a.CloseAllMirrorWatches()

	if err := os.WriteFile(path, []byte("<mxfile><diagram/></mxfile>"), 0o600); err != nil {
		t.Fatal(err)
	}
	assertNoMirrorChange(t, ch)
}

// A card promoted from a diagram board object carries its watch with
// it: the OLD object id stops firing, the NEW card id starts.
func TestMirrorWatch_PromoteBoardObject_RearmsUnderCardID(t *testing.T) {
	a := newTestAtlasService(t)
	ch := hookChannel(t)
	path := filepath.Join(t.TempDir(), "flow.drawio")
	if err := os.WriteFile(path, []byte("<mxfile></mxfile>"), 0o600); err != nil {
		t.Fatal(err)
	}
	o, err := a.CreateBoardObject("diagram", map[string]string{"mirrorPath": path}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	k, err := a.CreateKind("Doc", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	c, err := a.PromoteBoardObject(o.ID, k.ID, "Flow")
	if err != nil {
		t.Fatalf("PromoteBoardObject: %v", err)
	}

	if err := os.WriteFile(path, []byte("<mxfile><diagram/></mxfile>"), 0o600); err != nil {
		t.Fatal(err)
	}
	waitForMirrorChange(t, ch, c.ID)
}

func TestRepickCardMirror_UpdatesPathAndRearmsWatch(t *testing.T) {
	a := newTestAtlasService(t)
	ch := hookChannel(t)
	c := newMirroredCard(t, a, "old.drawio", "<mxfile></mxfile>")

	newPath := filepath.Join(t.TempDir(), "new.drawio")
	if err := os.WriteFile(newPath, []byte("<mxfile><diagram/></mxfile>"), 0o600); err != nil {
		t.Fatal(err)
	}
	updated, err := a.RepickCardMirror(c.ID, newPath)
	if err != nil {
		t.Fatalf("RepickCardMirror: %v", err)
	}
	if updated.MirrorPath != newPath {
		t.Errorf("MirrorPath = %q, want %q", updated.MirrorPath, newPath)
	}
	// Repick itself emits immediately -- no external edit needed.
	waitForMirrorChange(t, ch, c.ID)

	// The watch followed the new path: editing it fires again.
	if err := os.WriteFile(newPath, []byte("<mxfile><diagram/><diagram/></mxfile>"), 0o600); err != nil {
		t.Fatal(err)
	}
	waitForMirrorChange(t, ch, c.ID)
}

func TestRepickCardMirror_RejectsNonDiagramExtension(t *testing.T) {
	a := newTestAtlasService(t)
	c := newMirroredCard(t, a, "old.drawio", "<mxfile></mxfile>")

	if _, err := a.RepickCardMirror(c.ID, filepath.Join(t.TempDir(), "not-a-diagram.txt")); err == nil {
		t.Error("RepickCardMirror() with a non-diagram extension = nil error, want an error")
	}
}

func TestRepickObjectMirror_UpdatesPayloadAndRearmsWatch(t *testing.T) {
	a := newTestAtlasService(t)
	ch := hookChannel(t)
	oldPath := filepath.Join(t.TempDir(), "old.drawio")
	if err := os.WriteFile(oldPath, []byte("<mxfile></mxfile>"), 0o600); err != nil {
		t.Fatal(err)
	}
	o, err := a.CreateBoardObject("diagram", map[string]string{"mirrorPath": oldPath}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	newPath := filepath.Join(t.TempDir(), "new.drawio")
	if err := os.WriteFile(newPath, []byte("<mxfile><diagram/></mxfile>"), 0o600); err != nil {
		t.Fatal(err)
	}
	updated, err := a.RepickObjectMirror(o.ID, newPath)
	if err != nil {
		t.Fatalf("RepickObjectMirror: %v", err)
	}
	if updated.Payload["mirrorPath"] != newPath {
		t.Errorf("Payload[mirrorPath] = %q, want %q", updated.Payload["mirrorPath"], newPath)
	}
	// Repick itself emits immediately.
	waitForMirrorChange(t, ch, o.ID)

	// The watch followed the new path: editing it fires again.
	if err := os.WriteFile(newPath, []byte("<mxfile><diagram/><diagram/></mxfile>"), 0o600); err != nil {
		t.Fatal(err)
	}
	waitForMirrorChange(t, ch, o.ID)
}
