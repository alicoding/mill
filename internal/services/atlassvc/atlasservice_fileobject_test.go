package atlassvc

import (
	"encoding/base64"
	"os"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
)

func TestCreateFileObjectFromDownload_HappyPath_CreatesAPDFObject(t *testing.T) {
	a := newBlankAtlasService(t)
	a.SetCapturesDir(t.TempDir())

	raw := []byte("%PDF-1.4 not a real pdf but bytes are bytes")
	data := base64.StdEncoding.EncodeToString(raw)
	result, err := a.CreateFileObjectFromDownload(data, "quarterly-export.pdf", "run-1")
	if err != nil {
		t.Fatalf("CreateFileObjectFromDownload: %v", err)
	}
	if result.ObjectID == "" {
		t.Fatal("ObjectID is empty, want the new board object's id")
	}
	if result.Note != "" {
		t.Errorf("Note = %q, want empty on a fresh landing", result.Note)
	}

	obj, ok := objectByID(a, result.ObjectID)
	if !ok {
		t.Fatalf("no board object with id %q", result.ObjectID)
	}
	if obj.Kind != "pdf" {
		t.Errorf("Kind = %q, want %q", obj.Kind, "pdf")
	}
	if obj.Payload["mirrorName"] != "quarterly-export.pdf" {
		t.Errorf("Payload[mirrorName] = %q, want the browser's own filename", obj.Payload["mirrorName"])
	}
	if obj.Payload["sourceRunId"] != "run-1" {
		t.Errorf("Payload[sourceRunId] = %q, want %q", obj.Payload["sourceRunId"], "run-1")
	}
	wantChecksum := sha256Hex(raw)
	if obj.Payload["mirrorChecksum"] != wantChecksum {
		t.Errorf("Payload[mirrorChecksum] = %q, want %q", obj.Payload["mirrorChecksum"], wantChecksum)
	}
	written, err := os.ReadFile(obj.Payload["mirrorPath"]) //nolint:gosec // t.TempDir()-scoped path this test itself just wrote
	if err != nil {
		t.Fatalf("reading the mirrored file: %v", err)
	}
	if string(written) != string(raw) {
		t.Errorf("mirrored content = %q, want %q", written, raw)
	}
}

func TestCreateFileObjectFromDownload_SameContentTwice_MatchesRatherThanDuplicates(t *testing.T) {
	a := newBlankAtlasService(t)
	a.SetCapturesDir(t.TempDir())
	// newBlankAtlasService only tombstones CARDS -- the seeded example
	// space's own "Sample document" pdf board object (goal 0223) is
	// unrelated Kind content that survives it, so the count below is
	// asserted as a DELTA across the two calls, never an absolute.
	before := livePDFObjects(a)

	data := base64.StdEncoding.EncodeToString([]byte("identical export bytes"))
	first, err := a.CreateFileObjectFromDownload(data, "export.pdf", "run-1")
	if err != nil {
		t.Fatalf("first CreateFileObjectFromDownload: %v", err)
	}

	second, err := a.CreateFileObjectFromDownload(data, "export.pdf", "run-2")
	if err != nil {
		t.Fatalf("second CreateFileObjectFromDownload: %v", err)
	}
	if second.ObjectID != first.ObjectID {
		t.Errorf("second run's ObjectID = %q, want the SAME existing object %q -- a matching checksum must never duplicate", second.ObjectID, first.ObjectID)
	}
	if !strings.Contains(second.Note, "Already on the board since run run-1") {
		t.Errorf("second run's Note = %q, want it to name run-1 (the run that first landed it)", second.Note)
	}

	if got := livePDFObjects(a) - before; got != 1 {
		t.Errorf("new live pdf board objects across both calls = %d, want exactly 1", got)
	}
}

func TestCreateFileObjectFromDownload_DifferentContentNeverMatched(t *testing.T) {
	a := newBlankAtlasService(t)
	a.SetCapturesDir(t.TempDir())

	first, err := a.CreateFileObjectFromDownload(base64.StdEncoding.EncodeToString([]byte("version one")), "export.pdf", "run-1")
	if err != nil {
		t.Fatalf("first CreateFileObjectFromDownload: %v", err)
	}
	second, err := a.CreateFileObjectFromDownload(base64.StdEncoding.EncodeToString([]byte("version two")), "export.pdf", "run-2")
	if err != nil {
		t.Fatalf("second CreateFileObjectFromDownload: %v", err)
	}
	if second.ObjectID == first.ObjectID {
		t.Error("two downloads with different content resolved to the SAME object id")
	}
}

func TestCreateFileObjectFromDownload_UnresolvableExtension_SkipsWithAnHonestNote(t *testing.T) {
	a := newBlankAtlasService(t)
	a.SetCapturesDir(t.TempDir())

	result, err := a.CreateFileObjectFromDownload(base64.StdEncoding.EncodeToString([]byte("bytes")), "archive.zip", "run-1")
	if err != nil {
		t.Fatalf("CreateFileObjectFromDownload: %v", err)
	}
	if result.ObjectID != "" {
		t.Errorf("ObjectID = %q, want empty -- Mill has no board-object Kind for .zip", result.ObjectID)
	}
	if result.Note == "" {
		t.Error("Note is empty, want an honest sentence naming the gap")
	}
}

func livePDFObjects(a *AtlasService) int {
	n := 0
	for _, o := range a.objects {
		if o.DeletedAt.IsZero() && o.Kind == "pdf" {
			n++
		}
	}
	return n
}

// objectByID is this test file's own tiny read helper -- no exported
// single-object lookup exists on AtlasService today, and every
// production caller reads through CreateBoardObject's own return value
// instead.
func objectByID(a *AtlasService, id string) (atlas.BoardObject, bool) {
	for _, o := range a.objects {
		if o.ID == id {
			return o, true
		}
	}
	return atlas.BoardObject{}, false
}
