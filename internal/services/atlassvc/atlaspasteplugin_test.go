package atlassvc

import (
	"testing"
)

func wireBookmarkClaim(a *AtlasService) {
	a.WirePluginPasteClaims(func() []PluginPasteClaim {
		return []PluginPasteClaim{{Kind: "bookmark"}}
	})
}

// A bare URL paste with a wired claim lands the claiming kind's board
// object carrying the url-source payload contract (url + title=host).
func TestPasteToBoard_PluginURLClaim_LandsClaimedObject(t *testing.T) {
	a := newTestAtlasService(t)
	wireBookmarkClaim(a)
	res, err := a.PasteToBoard("https://example.com/some/page", "", "", 40, 50)
	if err != nil {
		t.Fatalf("PasteToBoard: %v", err)
	}
	if !res.Recognized || res.PluginObjects != 1 {
		t.Fatalf("result = %+v, want recognized with 1 plugin object", res)
	}
	var found bool
	for _, got := range a.Objects() {
		if got.Kind != "bookmark" {
			continue
		}
		found = true
		if got.Payload["url"] != "https://example.com/some/page" {
			t.Errorf("Payload[url] = %q, want the pasted URL", got.Payload["url"])
		}
		if got.Payload["title"] != "example.com" {
			t.Errorf("Payload[title] = %q, want the host", got.Payload["title"])
		}
		if got.Position.X != 40 || got.Position.Y != 50 {
			t.Errorf("Position = %+v, want the paste point (40,50)", got.Position)
		}
	}
	if !found {
		t.Fatal("no bookmark object landed")
	}
}

// With no claims wired (or none returned), a URL paste stays
// unrecognized so the frontend's note fallback still lands it.
func TestPasteToBoard_PluginURLClaim_NoClaimsFallsThrough(t *testing.T) {
	a := newTestAtlasService(t)
	res, err := a.PasteToBoard("https://example.com/x", "", "", 0, 0)
	if err != nil || res.Recognized {
		t.Fatalf("unwired result = %+v err=%v, want unrecognized", res, err)
	}

	a.WirePluginPasteClaims(func() []PluginPasteClaim { return nil })
	res, err = a.PasteToBoard("https://example.com/x", "", "", 0, 0)
	if err != nil || res.Recognized {
		t.Fatalf("empty-claims result = %+v err=%v, want unrecognized", res, err)
	}
}

// A claim only catches a single bare URL token -- prose containing a
// URL, a multi-line paste, or a non-URL string all stay note-bound.
func TestPasteToBoard_PluginURLClaim_OnlyBareURLs(t *testing.T) {
	a := newTestAtlasService(t)
	wireBookmarkClaim(a)
	for _, text := range []string{
		"see https://example.com for details",
		"https://example.com/x\nhttps://example.com/y",
		"not a url at all",
		"ftp://example.com/file",
	} {
		res, err := a.PasteToBoard(text, "", "", 0, 0)
		if err != nil || res.Recognized {
			t.Errorf("paste %q = %+v err=%v, want unrecognized", text, res, err)
		}
	}
}

// The chain's built-in entries stay ahead of plugin claims: an image
// URL still lands an image object, and TSV still lands a table, even
// with a URL claim wired.
func TestPasteToBoard_PluginURLClaim_BuiltInsWinFirst(t *testing.T) {
	a := newTestAtlasService(t)
	a.SetCapturesDir(t.TempDir())
	wireBookmarkClaim(a)
	a.imageURLFetcher = func(string) ([]byte, error) { return pngFixtureBytes, nil }
	res, err := a.PasteToBoard("https://example.com/pic.png", "", "", 0, 0)
	if err != nil {
		t.Fatalf("image URL paste: %v", err)
	}
	if !res.Recognized || res.Images != 1 || res.PluginObjects != 0 {
		t.Fatalf("image URL result = %+v, want the image entry to win", res)
	}
}

// With several claimants the FIRST wins and the rest are reported as
// alternatives once each, in order (ADR-0051 slice 2); a lone claimant
// reports none.
func TestPasteToBoard_PluginURLClaim_ReportsAlternatives(t *testing.T) {
	a := newTestAtlasService(t)
	a.WirePluginPasteClaims(func() []PluginPasteClaim {
		return []PluginPasteClaim{{Kind: "clip"}, {Kind: "bookmark"}, {Kind: "clip"}, {Kind: "archive"}}
	})
	res, err := a.PasteToBoard("https://example.com/some/page", "", "", 0, 0)
	if err != nil {
		t.Fatalf("PasteToBoard: %v", err)
	}
	if res.PluginKind != "clip" || res.PluginObjectID == "" {
		t.Fatalf("result = %+v, want the first claimant's kind and the landed id", res)
	}
	if got := res.AlternativeKinds; len(got) != 2 || got[0] != "bookmark" || got[1] != "archive" {
		t.Fatalf("AlternativeKinds = %v, want [bookmark archive]", got)
	}

	b := newTestAtlasService(t)
	wireBookmarkClaim(b)
	res, err = b.PasteToBoard("https://example.com/x", "", "", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.AlternativeKinds) != 0 {
		t.Fatalf("lone claimant AlternativeKinds = %v, want none", res.AlternativeKinds)
	}
}

// SetBoardObjectKind re-types the landed object in place: same id,
// payload, and position; undo restores the previous kind.
func TestSetBoardObjectKind_RetypesInPlaceAndUndoes(t *testing.T) {
	a := newTestAtlasService(t)
	wireBookmarkClaim(a)
	res, err := a.PasteToBoard("https://example.com/some/page", "", "", 40, 50)
	if err != nil {
		t.Fatal(err)
	}
	o, err := a.SetBoardObjectKind(res.PluginObjectID, "clip")
	if err != nil {
		t.Fatalf("SetBoardObjectKind: %v", err)
	}
	if o.ID != res.PluginObjectID || o.Kind != "clip" || o.Payload["url"] != "https://example.com/some/page" || o.Position.X != 40 {
		t.Fatalf("retyped = %+v, want same id/payload/position with kind clip", o)
	}
	if _, err := a.SetBoardObjectKind(o.ID, ""); err == nil {
		t.Fatal("empty kind accepted")
	}
	if _, err := a.SetBoardObjectKind("missing", "clip"); err == nil {
		t.Fatal("unknown id accepted")
	}
	a.Undo()
	for _, got := range a.Objects() {
		if got.ID == o.ID && got.Kind != "bookmark" {
			t.Fatalf("after undo kind = %q, want bookmark", got.Kind)
		}
	}
}
