package mcpsvc

import (
	"encoding/json"
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/atlassvc"
)

// The MCP door and the bound door read the SAME index: for one board
// the tool's entries equal ListContents' entries field for field,
// notes included with their derived first-line title.
func TestAtlasMCP_ListContents_MatchesTheBoundDoorAndListsNotes(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18139")
	root, _, _, _, _ := seedBoardObjectFixtures(t, h)
	if _, err := h.atlas.CreateNote("## Weekly plan\n- call the bank", atlas.Position{X: 5, Y: 6}, root); err != nil {
		t.Fatalf("CreateNote: %v", err)
	}
	if _, err := h.atlas.CreateNote("", atlas.Position{}, ""); err != nil {
		t.Fatalf("CreateNote empty: %v", err)
	}

	var got atlasListContentsResult
	if err := json.Unmarshal([]byte(h.call(t, "atlas_list_contents", map[string]any{})), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := contentEntriesOut(h.atlas.ListContents("", ""))
	if len(got.Entries) != len(want.Entries) || len(got.Entries) == 0 {
		t.Fatalf("tool listed %d entries, bound door %d", len(got.Entries), len(want.Entries))
	}
	for i := range want.Entries {
		g, w := got.Entries[i], want.Entries[i]
		if g.ID != w.ID || g.Kind != w.Kind || g.Title != w.Title || g.ParentID != w.ParentID || g.Subkind != w.Subkind {
			t.Errorf("entry %d differs: tool %+v, bound %+v", i, g, w)
		}
	}

	titles := map[string]string{}
	for _, e := range got.Entries {
		if e.Kind == atlassvc.ContentKindNote {
			titles[e.Title] = e.Payload["text"]
		}
	}
	if _, ok := titles["Weekly plan"]; !ok {
		t.Errorf("note not listed by its first line; note titles = %v", titles)
	}
	if _, ok := titles["Untitled note"]; !ok {
		t.Errorf("empty note not listed as Untitled note; note titles = %v", titles)
	}

	// Kind + parent filters narrow the same index.
	if err := json.Unmarshal([]byte(h.call(t, "atlas_list_contents", map[string]any{"kind": "note", "parentId": root})), &got); err != nil {
		t.Fatalf("decode filtered: %v", err)
	}
	if len(got.Entries) != 1 || got.Entries[0].Title != "Weekly plan" {
		t.Errorf("filtered = %+v, want exactly the filed note", got.Entries)
	}
}
