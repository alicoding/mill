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
