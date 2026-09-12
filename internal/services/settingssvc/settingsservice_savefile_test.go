package settingssvc

import (
	"bytes"
	"encoding/base64"
	"errors"
	"log/slog"
	"os"
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

func TestSaveBinaryFilePreservesBytesAndCancellation(t *testing.T) {
	content := []byte{0, 1, 0xff, 'm', 0}
	encoded := base64.StdEncoding.EncodeToString(content)
	var written []byte
	path, err := saveBinaryFile("backup.zip", encoded,
		func(name string) (string, error) {
			if name != "backup.zip" {
				t.Fatalf("suggested name = %q", name)
			}
			return "/chosen/backup.zip", nil
		},
		func(path string, got []byte, mode os.FileMode) error {
			if path != "/chosen/backup.zip" || mode != 0o600 {
				t.Fatalf("write = %q mode %o", path, mode)
			}
			written = append([]byte{}, got...)
			return nil
		})
	if err != nil || path != "/chosen/backup.zip" || !bytes.Equal(written, content) {
		t.Fatalf("save = %q, %v; bytes %v", path, err, written)
	}

	writes := 0
	path, err = saveBinaryFile("backup.zip", encoded,
		func(string) (string, error) { return "", nil },
		func(string, []byte, os.FileMode) error { writes++; return nil })
	if err != nil || path != "" || writes != 0 {
		t.Fatalf("cancel = %q, %v; writes %d", path, err, writes)
	}
}

func TestSaveBinaryFileWritesAnEmptyPayload(t *testing.T) {
	wrote := false
	path, err := saveBinaryFile("empty.bin", "",
		func(string) (string, error) { return "/chosen/empty.bin", nil },
		func(_ string, got []byte, _ os.FileMode) error {
			wrote = true
			if len(got) != 0 {
				t.Fatalf("bytes = %v, want empty", got)
			}
			return nil
		})
	if err != nil || path != "/chosen/empty.bin" || !wrote {
		t.Fatalf("save = %q, %v; wrote %v", path, err, wrote)
	}
}

func TestSaveBinaryFileRejectsMalformedContentBeforePrompt(t *testing.T) {
	prompts, writes := 0, 0
	path, err := saveBinaryFile("backup.zip", "YWJj=ignored",
		func(string) (string, error) { prompts++; return "/chosen", nil },
		func(string, []byte, os.FileMode) error { writes++; return nil })
	if err == nil || path != "" || prompts != 0 || writes != 0 {
		t.Fatalf("save = %q, %v; prompts %d writes %d", path, err, prompts, writes)
	}
}

func TestSaveBinaryFilePropagatesWriteFailure(t *testing.T) {
	want := errors.New("disk full")
	path, err := saveBinaryFile("backup.zip", base64.StdEncoding.EncodeToString([]byte("zip")),
		func(string) (string, error) { return "/chosen", nil },
		func(string, []byte, os.FileMode) error { return want })
	if path != "" || !errors.Is(err, want) {
		t.Fatalf("save = %q, %v", path, err)
	}
}

func TestSaveBinaryFileNoLiveApplicationErrors(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)
	path, err := set.SaveBinaryFile("export.zip", base64.StdEncoding.EncodeToString([]byte{0, 0xff}))
	if err == nil || path != "" {
		t.Fatalf("SaveBinaryFile() = %q, %v", path, err)
	}
}
