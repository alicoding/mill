package atlassvc

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
)

// newMirroredCard creates a fresh Kind + Card whose MirrorPath points
// at a file written with content under t.TempDir(), returning the
// card. UpdateCard (not CreateCard's own mirrorPath parameter) is used
// so this exercises the same write path the overlay's Save action
// takes.
func newMirroredCard(t *testing.T, a *AtlasService, filename, content string) atlas.Card {
	t.Helper()
	k, err := a.CreateKind("Doc", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	c, err := a.CreateCard(k.ID, "Mirrored", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	path := filepath.Join(t.TempDir(), filename)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	updated, err := a.UpdateCard(c.ID, c.Title, c.Note, c.Fields, c.Source, path, c.RefreshWorkflowID)
	if err != nil {
		t.Fatalf("UpdateCard: %v", err)
	}
	return updated
}

func TestMirrorContent_Markdown_RendersHTML(t *testing.T) {
	a := newTestAtlasService(t)
	c := newMirroredCard(t, a, "notes.md", "# Title\n\nBody text.")

	got, err := a.MirrorContent(c.ID)
	if err != nil {
		t.Fatalf("MirrorContent: %v", err)
	}
	if got.Kind != atlas.MirrorKindMarkdown {
		t.Errorf("Kind = %q, want markdown", got.Kind)
	}
	if !strings.Contains(got.Content, "<h1>Title</h1>") {
		t.Errorf("Content = %q, want rendered <h1>Title</h1>", got.Content)
	}
	if got.TooLarge {
		t.Error("TooLarge = true for a small file")
	}
}

func TestMirrorContent_PlainText_PassesThroughAsIs(t *testing.T) {
	a := newTestAtlasService(t)
	c := newMirroredCard(t, a, "log.txt", "line one\nline two")

	got, err := a.MirrorContent(c.ID)
	if err != nil {
		t.Fatalf("MirrorContent: %v", err)
	}
	if got.Kind != atlas.MirrorKindText {
		t.Errorf("Kind = %q, want text", got.Kind)
	}
	if got.Content != "line one\nline two" {
		t.Errorf("Content = %q, want the raw file content unchanged", got.Content)
	}
}

func TestMirrorContent_Image_ReturnsBase64WithMimeType(t *testing.T) {
	a := newTestAtlasService(t)
	raw := []byte{0x89, 0x50, 0x4e, 0x47} // not a valid PNG, but classification is extension-only
	c := newMirroredCard(t, a, "photo.png", string(raw))

	got, err := a.MirrorContent(c.ID)
	if err != nil {
		t.Fatalf("MirrorContent: %v", err)
	}
	if got.Kind != atlas.MirrorKindImage {
		t.Errorf("Kind = %q, want image", got.Kind)
	}
	if got.MimeType != "image/png" {
		t.Errorf("MimeType = %q, want image/png", got.MimeType)
	}
	decoded, err := base64.StdEncoding.DecodeString(got.Content)
	if err != nil {
		t.Fatalf("Content is not valid base64: %v", err)
	}
	if string(decoded) != string(raw) {
		t.Errorf("decoded Content = %q, want %q", decoded, raw)
	}
}

// --- ObjectMirrorContent (goal 0179/0180): the same read/classify
// door, keyed off a board object's Payload["mirrorPath"] instead of a
// card's MirrorPath field. ---

func TestObjectMirrorContent_Image_ReturnsBase64WithMimeType(t *testing.T) {
	a := newTestAtlasService(t)
	raw := []byte{0x89, 0x50, 0x4e, 0x47} // not a valid PNG, but classification is extension-only
	path := filepath.Join(t.TempDir(), "shot.png")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	o, err := a.CreateBoardObject("image", map[string]string{"mirrorPath": path}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	got, err := a.ObjectMirrorContent(o.ID)
	if err != nil {
		t.Fatalf("ObjectMirrorContent: %v", err)
	}
	if got.Kind != atlas.MirrorKindImage {
		t.Errorf("Kind = %q, want image", got.Kind)
	}
	if got.MimeType != "image/png" {
		t.Errorf("MimeType = %q, want image/png", got.MimeType)
	}
	decoded, err := base64.StdEncoding.DecodeString(got.Content)
	if err != nil {
		t.Fatalf("Content is not valid base64: %v", err)
	}
	if string(decoded) != string(raw) {
		t.Errorf("decoded Content = %q, want %q", decoded, raw)
	}
}

// A "diagram" board object (goal 0179 S2) is text-kind, not image-kind
// -- the native file-drop door lands its mirrorPath exactly as image's
// own drop does, but a .drawio/.mmd source classifies and reads back
// as plain text through the SAME mirrorContentForPath shared logic.
func TestObjectMirrorContent_DrawioSource_ReturnsPlainText(t *testing.T) {
	a := newTestAtlasService(t)
	xml := `<mxfile><diagram name="Page-1"><mxGraphModel/></diagram></mxfile>`
	path := filepath.Join(t.TempDir(), "flow.drawio")
	if err := os.WriteFile(path, []byte(xml), 0o600); err != nil {
		t.Fatal(err)
	}
	o, err := a.CreateBoardObject("diagram", map[string]string{"mirrorPath": path}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	got, err := a.ObjectMirrorContent(o.ID)
	if err != nil {
		t.Fatalf("ObjectMirrorContent: %v", err)
	}
	if got.Kind != atlas.MirrorKindText {
		t.Errorf("Kind = %q, want text", got.Kind)
	}
	if got.Content != xml {
		t.Errorf("Content = %q, want the raw .drawio source unchanged", got.Content)
	}
}

// A "sheet" board object's own .xlsx mirror is binary-kind, base64
// encoded the same way an image is (goal 0232 S2) -- unlike a
// diagram's .drawio source, which classifies and reads back as plain
// text.
func TestObjectMirrorContent_XlsxSource_ReturnsBase64WithMimeType(t *testing.T) {
	a := newTestAtlasService(t)
	raw := []byte{0x50, 0x4b, 0x03, 0x04} // not a valid xlsx, but classification is extension-only
	path := filepath.Join(t.TempDir(), "book.xlsx")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	o, err := a.CreateBoardObject("sheet", map[string]string{"mirrorPath": path}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	got, err := a.ObjectMirrorContent(o.ID)
	if err != nil {
		t.Fatalf("ObjectMirrorContent: %v", err)
	}
	if got.Kind != atlas.MirrorKindSheet {
		t.Errorf("Kind = %q, want sheet", got.Kind)
	}
	if got.MimeType != "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" {
		t.Errorf("MimeType = %q, want the xlsx MIME type", got.MimeType)
	}
	decoded, err := base64.StdEncoding.DecodeString(got.Content)
	if err != nil {
		t.Fatalf("Content is not valid base64: %v", err)
	}
	if string(decoded) != string(raw) {
		t.Errorf("decoded Content = %q, want %q", decoded, raw)
	}
}

// A "sheet" board object's own .csv mirror is text-kind, the same
// shared mirrorContentForPath path a diagram's .drawio source takes.
func TestObjectMirrorContent_CsvSource_ReturnsPlainText(t *testing.T) {
	a := newTestAtlasService(t)
	csv := "Name,Age\nAda,36"
	path := filepath.Join(t.TempDir(), "rows.csv")
	if err := os.WriteFile(path, []byte(csv), 0o600); err != nil {
		t.Fatal(err)
	}
	o, err := a.CreateBoardObject("sheet", map[string]string{"mirrorPath": path}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	got, err := a.ObjectMirrorContent(o.ID)
	if err != nil {
		t.Fatalf("ObjectMirrorContent: %v", err)
	}
	if got.Kind != atlas.MirrorKindText {
		t.Errorf("Kind = %q, want text", got.Kind)
	}
	if got.Content != csv {
		t.Errorf("Content = %q, want the raw .csv source unchanged", got.Content)
	}
}

func TestObjectMirrorContent_NoMirrorPath_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	o, err := a.CreateBoardObject("ink", nil, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	if _, err := a.ObjectMirrorContent(o.ID); err == nil {
		t.Error("ObjectMirrorContent() with no mirrorPath = nil error, want an error")
	}
}

func TestObjectMirrorContent_UnknownObject_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	if _, err := a.ObjectMirrorContent("does-not-exist"); err == nil {
		t.Error("ObjectMirrorContent() on an unknown id = nil error, want an error")
	}
}

func TestMirrorContent_OtherKind_ReportsSizeWithoutContent(t *testing.T) {
	a := newTestAtlasService(t)
	c := newMirroredCard(t, a, "archive.zip", "not really a zip, just bytes")

	got, err := a.MirrorContent(c.ID)
	if err != nil {
		t.Fatalf("MirrorContent: %v", err)
	}
	if got.Kind != atlas.MirrorKindOther {
		t.Errorf("Kind = %q, want other", got.Kind)
	}
	if got.Content != "" {
		t.Errorf("Content = %q, want empty for an unsupported kind", got.Content)
	}
	if got.Size == 0 {
		t.Error("Size = 0, want the file's real size even though content isn't loaded")
	}
}

func TestMirrorContent_OverSizeCap_ReportsTooLargeWithoutContent(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Doc", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	c, err := a.CreateCard(k.ID, "Mirrored", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	path := filepath.Join(t.TempDir(), "huge.md")
	f, err := os.Create(path) //nolint:gosec // t.TempDir()-scoped test fixture path, not user input
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(mirrorPreviewMaxBytes + 1); err != nil {
		_ = f.Close()
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := a.UpdateCard(c.ID, c.Title, c.Note, c.Fields, c.Source, path, c.RefreshWorkflowID); err != nil {
		t.Fatalf("UpdateCard: %v", err)
	}

	got, err := a.MirrorContent(c.ID)
	if err != nil {
		t.Fatalf("MirrorContent: %v", err)
	}
	if !got.TooLarge {
		t.Error("TooLarge = false, want true for a file over mirrorPreviewMaxBytes")
	}
	if got.Content != "" {
		t.Errorf("Content = %q, want empty when TooLarge", got.Content)
	}
	if got.Size != mirrorPreviewMaxBytes+1 {
		t.Errorf("Size = %d, want %d", got.Size, mirrorPreviewMaxBytes+1)
	}
}

func TestMirrorContent_NoMirrorPath_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Doc", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	c, err := a.CreateCard(k.ID, "No mirror", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	if _, err := a.MirrorContent(c.ID); err == nil {
		t.Error("MirrorContent() for a card with no MirrorPath = nil error, want an error")
	}
}

// A file that vanishes between the card carrying its path and this
// read reports Missing rather than erroring (goal 0194's honest-state
// contract) -- the frontend renders "file's gone" instead of a raw Go
// error string.
func TestMirrorContent_MissingFile_ReportsMissingWithoutError(t *testing.T) {
	a := newTestAtlasService(t)
	c := newMirroredCard(t, a, "flow.drawio", "<mxfile></mxfile>")
	if err := os.Remove(c.MirrorPath); err != nil {
		t.Fatal(err)
	}

	got, err := a.MirrorContent(c.ID)
	if err != nil {
		t.Fatalf("MirrorContent() on a vanished file: unexpected error %v, want Missing=true with nil error", err)
	}
	if !got.Missing {
		t.Error("Missing = false, want true for a file that no longer exists on disk")
	}
	if got.Content != "" || got.Size != 0 {
		t.Errorf("got = %+v, want zero Content/Size when Missing", got)
	}
}

func TestObjectMirrorContent_MissingFile_ReportsMissingWithoutError(t *testing.T) {
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

	got, err := a.ObjectMirrorContent(o.ID)
	if err != nil {
		t.Fatalf("ObjectMirrorContent() on a vanished file: unexpected error %v, want Missing=true with nil error", err)
	}
	if !got.Missing {
		t.Error("Missing = false, want true for a file that no longer exists on disk")
	}
}

func TestMirrorContent_UnknownCard_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	if _, err := a.MirrorContent("does-not-exist"); err == nil {
		t.Error("MirrorContent() for an unknown card = nil error, want an error")
	}
}

func TestMirrorRawBytes_OtherKind_ReturnsBytesMirrorContentWithholds(t *testing.T) {
	a := newTestAtlasService(t)
	raw := "not really a zip, just bytes"
	c := newMirroredCard(t, a, "archive.zip", raw)

	got, err := a.MirrorRawBytes(c.ID)
	if err != nil {
		t.Fatalf("MirrorRawBytes: %v", err)
	}
	decoded, err := base64.StdEncoding.DecodeString(got)
	if err != nil {
		t.Fatalf("result is not valid base64: %v", err)
	}
	if string(decoded) != raw {
		t.Errorf("decoded = %q, want %q", decoded, raw)
	}
}

func TestMirrorRawBytes_TextKind_RoundTrips(t *testing.T) {
	a := newTestAtlasService(t)
	raw := "line one\nline two"
	c := newMirroredCard(t, a, "log.txt", raw)

	got, err := a.MirrorRawBytes(c.ID)
	if err != nil {
		t.Fatalf("MirrorRawBytes: %v", err)
	}
	decoded, err := base64.StdEncoding.DecodeString(got)
	if err != nil {
		t.Fatalf("result is not valid base64: %v", err)
	}
	if string(decoded) != raw {
		t.Errorf("decoded = %q, want %q", decoded, raw)
	}
}

func TestMirrorRawBytes_OverSizeCap_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Doc", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	c, err := a.CreateCard(k.ID, "Mirrored", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	path := filepath.Join(t.TempDir(), "huge.bin")
	f, err := os.Create(path) //nolint:gosec // t.TempDir()-scoped test fixture path, not user input
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(mirrorPreviewMaxBytes + 1); err != nil {
		_ = f.Close()
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := a.UpdateCard(c.ID, c.Title, c.Note, c.Fields, c.Source, path, c.RefreshWorkflowID); err != nil {
		t.Fatalf("UpdateCard: %v", err)
	}

	if _, err := a.MirrorRawBytes(c.ID); err == nil {
		t.Error("MirrorRawBytes() for a file over mirrorPreviewMaxBytes = nil error, want an error")
	}
}

func TestMirrorRawBytes_NoMirrorPath_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Doc", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	c, err := a.CreateCard(k.ID, "No mirror", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	if _, err := a.MirrorRawBytes(c.ID); err == nil {
		t.Error("MirrorRawBytes() for a card with no MirrorPath = nil error, want an error")
	}
}

func TestMirrorRawBytes_UnknownCard_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	if _, err := a.MirrorRawBytes("does-not-exist"); err == nil {
		t.Error("MirrorRawBytes() for an unknown card = nil error, want an error")
	}
}

