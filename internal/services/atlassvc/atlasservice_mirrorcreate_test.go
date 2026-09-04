package atlassvc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// SaveMirrorText is the door an agent-authored file-backed board object
// lands its bytes through (goal 0323) -- the checks below are the
// fail-closed ones that must hold before anything reaches disk.

func TestSaveMirrorText_WritesUnderCapturesAndNamesByTitle(t *testing.T) {
	a := newTestAtlasService(t)
	dir := t.TempDir()
	a.SetCapturesDir(dir)

	path, err := a.SaveMirrorText("<mxfile><diagram/></mxfile>", ".drawio", "Runtime path")
	if err != nil {
		t.Fatalf("SaveMirrorText: %v", err)
	}
	if filepath.Dir(path) != dir || !strings.HasSuffix(path, ".drawio") {
		t.Errorf("path = %q, want a .drawio under %q", path, dir)
	}
	data, err := os.ReadFile(path) //nolint:gosec // path is the value under test, minted by SaveMirrorText itself
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if string(data) != "<mxfile><diagram/></mxfile>" {
		t.Errorf("content = %q", data)
	}

	// A second save with the same title never overwrites the first.
	second, err := a.SaveMirrorText("<mxfile/>", ".drawio", "Runtime path")
	if err != nil {
		t.Fatalf("second SaveMirrorText: %v", err)
	}
	if second == path {
		t.Error("two saves collided on one filename")
	}
}

func TestSaveMirrorText_Refusals(t *testing.T) {
	a := newTestAtlasService(t)

	if _, err := a.SaveMirrorText("x", ".drawio", "no dir"); err == nil ||
		!strings.Contains(err.Error(), "no captures directory") {
		t.Errorf("without a captures directory: err = %v", err)
	}

	a.SetCapturesDir(t.TempDir())
	for _, tc := range []struct{ content, ext, want string }{
		{"x", ".xlsx", "not a text-backed mirror extension"},
		{"x", ".exe", "not a text-backed mirror extension"},
		{"   ", ".drawio", "content is empty"},
	} {
		if _, err := a.SaveMirrorText(tc.content, tc.ext, "t"); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("SaveMirrorText(%q, %q): err = %v, want one naming %q", tc.content, tc.ext, err, tc.want)
		}
	}
}
