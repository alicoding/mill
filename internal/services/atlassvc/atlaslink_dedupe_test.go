package atlassvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// Regression (goal 0124): repeated link-drags between the same pair
// inflated the link count without bound -- creation must be
// idempotent per (from, to, kind), and reverse direction stays a
// distinct link (directional kinds are legitimate).
func TestCreateLink_SamePairAndKindIsIdempotent(t *testing.T) {
	svc := newTestAtlasService(t)
	kind, err := svc.CreateKind("Thing", "", "", []typedfield.Field{})
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	a, _ := svc.CreateCard(kind.ID, "A", "", nil, "", nil, "", "", "", "")
	b, _ := svc.CreateCard(kind.ID, "B", "", nil, "", nil, "", "", "", "")
	lk, err := svc.CreateLinkKind("relates to", "")
	if err != nil {
		t.Fatalf("CreateLinkKind: %v", err)
	}

	first, err := svc.CreateLink(a.ID, b.ID, lk.ID, "")
	if err != nil {
		t.Fatalf("first CreateLink: %v", err)
	}
	second, err := svc.CreateLink(a.ID, b.ID, lk.ID, "")
	if err != nil {
		t.Fatalf("duplicate CreateLink: %v", err)
	}
	if second.ID != first.ID {
		t.Errorf("duplicate created a new link %q, want the existing %q", second.ID, first.ID)
	}
	if got := countLinksBetween(svc, a.ID, b.ID, lk.ID); got != 1 {
		t.Errorf("links between pair = %d, want 1", got)
	}

	if _, err := svc.CreateLink(b.ID, a.ID, lk.ID, ""); err != nil {
		t.Fatalf("reverse-direction CreateLink: %v", err)
	}
	if got := countLinksBetween(svc, b.ID, a.ID, lk.ID); got != 1 {
		t.Errorf("reverse link count = %d, want 1 (a distinct, single link)", got)
	}
}

func countLinksBetween(svc *AtlasService, from, to, kind string) int {
	n := 0
	for _, l := range svc.Links() {
		if l.FromCardID == from && l.ToCardID == to && l.LinkKindID == kind {
			n++
		}
	}
	return n
}

func TestDedupeLinks_KeepsFirstPerPairAndKind(t *testing.T) {
	links := []atlas.Link{
		{ID: "l1", FromCardID: "a", ToCardID: "b", LinkKindID: "k"},
		{ID: "l2", FromCardID: "a", ToCardID: "b", LinkKindID: "k"},
		{ID: "l3", FromCardID: "b", ToCardID: "a", LinkKindID: "k"},
		{ID: "l4", FromCardID: "a", ToCardID: "b", LinkKindID: "other"},
		{ID: "l5", FromCardID: "a", ToCardID: "b", LinkKindID: "k"},
	}
	out := dedupeLinks(links)
	if len(out) != 3 {
		t.Fatalf("dedupe kept %d links, want 3 (first duplicate wins; reverse + other-kind stay)", len(out))
	}
	if out[0].ID != "l1" || out[1].ID != "l3" || out[2].ID != "l4" {
		t.Errorf("dedupe kept %v, want l1/l3/l4", []string{out[0].ID, out[1].ID, out[2].ID})
	}
}
