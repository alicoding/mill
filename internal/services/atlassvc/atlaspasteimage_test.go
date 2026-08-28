package atlassvc

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// A minimal but real PNG signature followed by a few bytes -- these
// tests never decode the image, only mirror and count its bytes, so
// SaveImageBytes/MirrorImageFromPath's own byte-for-byte round trip is
// all that's checked.
var pngFixtureBytes = []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03}

func imageObjectCount(a *AtlasService) int {
	n := 0
	for _, o := range a.Objects() {
		if o.Kind == "image" {
			n++
		}
	}
	return n
}

// A pasted local path to a real image file lands an "image" board
// object, mirroring the bytes into the captures dir -- never a card
// (goal 0179's founding rule) and never a note (the Slice 0 gap this
// closes).
func TestPasteToBoard_LocalImagePathBecomesImageObject(t *testing.T) {
	a := newTestAtlasService(t)
	a.SetCapturesDir(t.TempDir())
	before := imageObjectCount(a)

	srcDir := t.TempDir()
	srcPath := filepath.Join(srcDir, "diagram.png")
	if err := os.WriteFile(srcPath, pngFixtureBytes, 0o600); err != nil {
		t.Fatalf("writing fixture image: %v", err)
	}

	res, err := a.PasteToBoard(srcPath, "", "", 40, 60)
	if err != nil {
		t.Fatalf("PasteToBoard: %v", err)
	}
	if !res.Recognized || res.Images != 1 || res.Cards != 0 || res.Tables != 0 {
		t.Fatalf("result = %+v, want recognized image, no cards/tables", res)
	}
	if got := imageObjectCount(a); got != before+1 {
		t.Fatalf("image object count = %d, want %d", got, before+1)
	}
	var found bool
	for _, o := range a.Objects() {
		if o.Kind != "image" || o.Payload["title"] != "diagram" {
			continue
		}
		found = true
		mirrored, err := os.ReadFile(o.Payload["mirrorPath"]) //nolint:gosec // test-owned path this same call just created
		if err != nil {
			t.Fatalf("reading mirrored file: %v", err)
		}
		if string(mirrored) != string(pngFixtureBytes) {
			t.Errorf("mirrored bytes = %v, want %v", mirrored, pngFixtureBytes)
		}
		if o.Position.X != 40 || o.Position.Y != 60 {
			t.Errorf("position = %+v, want paste origin", o.Position)
		}
	}
	if !found {
		t.Error("expected a mirrored image object titled \"diagram\"")
	}
}

// A pasted http(s) URL ending in a recognized image extension is
// fetched once (through the injectable fetcher, never the real
// network in this test) and mirrored the same way a local path is.
func TestPasteToBoard_ImageURLBecomesImageObject(t *testing.T) {
	a := newTestAtlasService(t)
	a.SetCapturesDir(t.TempDir())

	var fetchedURL string
	a.imageURLFetcher = func(rawURL string) ([]byte, error) {
		fetchedURL = rawURL
		return pngFixtureBytes, nil
	}

	res, err := a.PasteToBoard("https://example.com/photos/logo.png", "", "", 0, 0)
	if err != nil {
		t.Fatalf("PasteToBoard: %v", err)
	}
	if !res.Recognized || res.Images != 1 {
		t.Fatalf("result = %+v, want a recognized image", res)
	}
	if fetchedURL != "https://example.com/photos/logo.png" {
		t.Errorf("fetcher called with %q, want the pasted URL verbatim", fetchedURL)
	}
	var found bool
	for _, o := range a.Objects() {
		if o.Kind == "image" && o.Payload["title"] == "logo" {
			found = true
		}
	}
	if !found {
		t.Error("expected a mirrored image object titled \"logo\"")
	}
}

// A fetch failure (network error, 404, a non-image response) is an
// honest non-match, not a surfaced error -- the caller's own note
// fallback is what lands the paste as something (goal 0218).
func TestPasteToBoard_ImageURLFetchFailure_FallsThrough(t *testing.T) {
	a := newTestAtlasService(t)
	a.SetCapturesDir(t.TempDir())
	before := imageObjectCount(a)
	a.imageURLFetcher = func(string) ([]byte, error) {
		return nil, fmt.Errorf("boom")
	}

	res, err := a.PasteToBoard("https://example.com/gone.png", "", "", 0, 0)
	if err != nil {
		t.Fatalf("PasteToBoard: %v", err)
	}
	if res.Recognized {
		t.Fatalf("result = %+v, want NOT recognized on fetch failure", res)
	}
	if got := imageObjectCount(a); got != before {
		t.Errorf("image object count = %d, want unchanged at %d", got, before)
	}
}

// A path that looks image-shaped but doesn't exist on disk is just
// text -- it falls through so the frontend's note door can still land
// the raw string, exactly like today's pre-fix behavior for any other
// unrecognized paste.
func TestPasteToBoard_NonexistentImagePath_FallsThrough(t *testing.T) {
	a := newTestAtlasService(t)
	a.SetCapturesDir(t.TempDir())
	before := imageObjectCount(a)

	res, err := a.PasteToBoard(filepath.Join(t.TempDir(), "never-written.png"), "", "", 0, 0)
	if err != nil {
		t.Fatalf("PasteToBoard: %v", err)
	}
	if res.Recognized {
		t.Fatalf("result = %+v, want NOT recognized for a nonexistent path", res)
	}
	if got := imageObjectCount(a); got != before {
		t.Errorf("image object count = %d, want unchanged at %d", got, before)
	}
}

// A real, existing file whose extension isn't a recognized image type
// falls through too -- this recognizer only ever claims image
// extensions, same allow-list SaveImageBytes/MirrorImageFromPath
// already enforce.
func TestPasteToBoard_NonImageExtension_FallsThrough(t *testing.T) {
	a := newTestAtlasService(t)
	a.SetCapturesDir(t.TempDir())
	before := imageObjectCount(a)

	srcPath := filepath.Join(t.TempDir(), "notes.txt")
	if err := os.WriteFile(srcPath, []byte("just some notes"), 0o600); err != nil {
		t.Fatalf("writing fixture file: %v", err)
	}

	res, err := a.PasteToBoard(srcPath, "", "", 0, 0)
	if err != nil {
		t.Fatalf("PasteToBoard: %v", err)
	}
	if res.Recognized {
		t.Fatalf("result = %+v, want NOT recognized for a non-image extension", res)
	}
	if got := imageObjectCount(a); got != before {
		t.Errorf("image object count = %d, want unchanged at %d", got, before)
	}
}
