package atlassvc

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestSaveImageBytes_WritesFileUnderCapturesDir(t *testing.T) {
	a := newBlankAtlasService(t)
	a.SetCapturesDir(t.TempDir())

	raw := []byte("not-really-a-png-but-bytes-are-bytes")
	path, err := a.SaveImageBytes(base64.StdEncoding.EncodeToString(raw), ".png", "Pasted image")
	if err != nil {
		t.Fatalf("SaveImageBytes: %v", err)
	}
	if filepath.Ext(path) != ".png" {
		t.Errorf("path = %q, want a .png file", path)
	}
	got, err := os.ReadFile(path) //nolint:gosec // t.TempDir()-scoped path SaveImageBytes itself just returned, not user input
	if err != nil {
		t.Fatalf("reading written file: %v", err)
	}
	if string(got) != string(raw) {
		t.Errorf("written content = %q, want %q", got, raw)
	}
}

func TestSaveImageBytes_RejectsNonImageExtension(t *testing.T) {
	a := newBlankAtlasService(t)
	a.SetCapturesDir(t.TempDir())

	if _, err := a.SaveImageBytes(base64.StdEncoding.EncodeToString([]byte("x")), ".exe", "malware"); err == nil {
		t.Error("SaveImageBytes(.exe) = nil error, want a rejection")
	}
}

func TestSaveImageBytes_RejectsInvalidBase64(t *testing.T) {
	a := newBlankAtlasService(t)
	a.SetCapturesDir(t.TempDir())

	if _, err := a.SaveImageBytes("not-base64!!!", ".png", "bad"); err == nil {
		t.Error("SaveImageBytes(invalid base64) = nil error, want a decode error")
	}
}

func TestSaveImageBytes_NoCapturesDirConfigured_Errors(t *testing.T) {
	a := newBlankAtlasService(t)
	if _, err := a.SaveImageBytes(base64.StdEncoding.EncodeToString([]byte("x")), ".png", "x"); err == nil {
		t.Error("SaveImageBytes with no captures dir configured = nil error, want an error")
	}
}

func TestPickImageFile_TestEnvBypassesRealDialog(t *testing.T) {
	a := newBlankAtlasService(t)
	want := filepath.Join(t.TempDir(), "picked.png")
	t.Setenv(testImagePickPathEnv, want)
	got, err := a.PickImageFile()
	if err != nil {
		t.Fatalf("PickImageFile: %v", err)
	}
	if got != want {
		t.Errorf("PickImageFile() = %q, want the env-injected %q", got, want)
	}
}

func TestMirrorImageFromPath_CopiesBytesIntoCapturesDir(t *testing.T) {
	a := newBlankAtlasService(t)
	a.SetCapturesDir(t.TempDir())

	srcDir := t.TempDir()
	srcPath := filepath.Join(srcDir, "promoted-temp-file.png")
	raw := []byte("real image bytes, ephemeral source path")
	if err := os.WriteFile(srcPath, raw, 0o600); err != nil {
		t.Fatalf("seed source file: %v", err)
	}

	mirrorPath, err := a.MirrorImageFromPath(srcPath, "Dropped image")
	if err != nil {
		t.Fatalf("MirrorImageFromPath: %v", err)
	}
	if mirrorPath == srcPath {
		t.Fatalf("MirrorImageFromPath() returned the SOURCE path %q -- it must copy into a Mill-owned file, not point at an ephemeral original", mirrorPath)
	}
	got, err := os.ReadFile(mirrorPath) //nolint:gosec // t.TempDir()-scoped path this test itself just wrote
	if err != nil {
		t.Fatalf("reading mirrored file: %v", err)
	}
	if string(got) != string(raw) {
		t.Errorf("mirrored content = %q, want %q", got, raw)
	}

	// The source file can now be removed (simulating the OS reclaiming a
	// temp/promise path) without the mirrored copy being affected.
	if err := os.Remove(srcPath); err != nil {
		t.Fatalf("remove source file: %v", err)
	}
	if _, err := os.Stat(mirrorPath); err != nil {
		t.Errorf("mirrored file no longer exists after source removal: %v", err)
	}
}

func TestMirrorImageFromPath_RejectsNonImageExtension(t *testing.T) {
	a := newBlankAtlasService(t)
	a.SetCapturesDir(t.TempDir())

	srcPath := filepath.Join(t.TempDir(), "notes.pdf")
	if err := os.WriteFile(srcPath, []byte("x"), 0o600); err != nil {
		t.Fatalf("seed source file: %v", err)
	}
	if _, err := a.MirrorImageFromPath(srcPath, "notes"); err == nil {
		t.Error("MirrorImageFromPath(.pdf) = nil error, want a rejection")
	}
}
