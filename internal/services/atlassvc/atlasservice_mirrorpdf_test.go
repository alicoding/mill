package atlassvc

// MirrorKindPdf's own service-layer tests (goal 0267), split from
// atlasservice_mirror_test.go at the 500-line convention: the pdf
// branch's base64/mime round-trip and its larger, kind-specific
// preview cap.

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
)
func TestObjectMirrorContent_Pdf_ReturnsBase64WithMimeType(t *testing.T) {
	a := newTestAtlasService(t)
	raw := []byte("%PDF-1.4 not a real pdf, classification is extension-only")
	path := filepath.Join(t.TempDir(), "report.pdf")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	o, err := a.CreateBoardObject("pdf", map[string]string{"mirrorPath": path}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	got, err := a.ObjectMirrorContent(o.ID)
	if err != nil {
		t.Fatalf("ObjectMirrorContent: %v", err)
	}
	if got.Kind != atlas.MirrorKindPdf {
		t.Errorf("Kind = %q, want pdf", got.Kind)
	}
	if got.MimeType != "application/pdf" {
		t.Errorf("MimeType = %q, want application/pdf", got.MimeType)
	}
	decoded, err := base64.StdEncoding.DecodeString(got.Content)
	if err != nil {
		t.Fatalf("Content is not valid base64: %v", err)
	}
	if string(decoded) != string(raw) {
		t.Error("decoded content does not round-trip the file bytes")
	}
}

func TestObjectMirrorContent_Pdf_UsesTheLargerPdfCap(t *testing.T) {
	a := newTestAtlasService(t)
	path := filepath.Join(t.TempDir(), "big.pdf")
	f, err := os.Create(path) //nolint:gosec // t.TempDir()-scoped test fixture path, not user input
	if err != nil {
		t.Fatal(err)
	}
	// Over the generic preview cap but under the PDF cap: content must
	// still load (the PDF cap is the one that applies).
	if err := f.Truncate(mirrorPreviewMaxBytes + 1); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	o, err := a.CreateBoardObject("pdf", map[string]string{"mirrorPath": path}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	got, err := a.ObjectMirrorContent(o.ID)
	if err != nil {
		t.Fatalf("ObjectMirrorContent: %v", err)
	}
	if got.TooLarge {
		t.Error("TooLarge = true under the PDF cap, want content loaded")
	}
	if got.Content == "" {
		t.Error("Content empty, want the base64 bytes")
	}
}
