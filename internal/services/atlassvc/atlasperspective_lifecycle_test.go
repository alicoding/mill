package atlassvc

import (
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// This file continues atlasperspective_test.go (split for the 500-line
// convention, .claude/rules/architecture.md): authoring-while-active,
// delete cascade, purge integration, export/import, and dataevent
// coverage for ADR-0041/goal 0095's Perspective.

// --- Authoring-while-active (ADR-0041) ---

func TestCreateCard_JoinsActivePerspectiveWithAncestryClosure(t *testing.T) {
	a := newBlankAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	root, err := a.CreateCard(k.ID, "Root", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(root): %v", err)
	}
	child, err := a.CreateCard(k.ID, "Child", "", nil, root.ID, nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(child): %v", err)
	}
	p, err := a.CreatePerspective(root.ID, "Current", "")
	if err != nil {
		t.Fatalf("CreatePerspective: %v", err)
	}
	if err := a.SetAtlasSession(AtlasSessionState{ActivePerspectiveID: p.ID}); err != nil {
		t.Fatalf("SetAtlasSession: %v", err)
	}

	authored, err := a.CreateCard(k.ID, "Authored", "", nil, child.ID, nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(authored): %v", err)
	}

	var got atlas.Perspective
	for _, got2 := range a.Perspectives() {
		if got2.ID == p.ID {
			got = got2
		}
	}
	if !containsID(got.MemberCardIDs, authored.ID) {
		t.Errorf("active perspective's MemberCardIDs = %v, want the freshly authored card %q", got.MemberCardIDs, authored.ID)
	}
	if !containsID(got.MemberCardIDs, child.ID) {
		t.Errorf("active perspective's MemberCardIDs = %v, want the authored card's container %q too (ancestry closure)", got.MemberCardIDs, child.ID)
	}
}

func TestCreateCard_OutsideActivePerspectiveSpace_DoesNotJoin(t *testing.T) {
	a := newBlankAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	spaceA, err := a.CreateCard(k.ID, "Space A", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(spaceA): %v", err)
	}
	p, err := a.CreatePerspective(spaceA.ID, "Current", "")
	if err != nil {
		t.Fatalf("CreatePerspective: %v", err)
	}
	if err := a.SetAtlasSession(AtlasSessionState{ActivePerspectiveID: p.ID}); err != nil {
		t.Fatalf("SetAtlasSession: %v", err)
	}

	// A card created at the TRUE root (unrelated to spaceA's subtree)
	// must not join a perspective scoped to a different space.
	outside, err := a.CreateCard(k.ID, "Outside", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(outside): %v", err)
	}
	for _, got := range a.Perspectives() {
		if got.ID == p.ID && containsID(got.MemberCardIDs, outside.ID) {
			t.Errorf("perspective scoped to %q gained member %q, which lives outside its space", spaceA.ID, outside.ID)
		}
	}
}

func TestCreateLink_JoinsActivePerspective(t *testing.T) {
	a := newBlankAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	c1, err := a.CreateCard(k.ID, "A", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	c2, err := a.CreateCard(k.ID, "B", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	lk, err := a.CreateLinkKind("relates to", "")
	if err != nil {
		t.Fatalf("CreateLinkKind: %v", err)
	}
	p, err := a.CreatePerspective("", "Current", "")
	if err != nil {
		t.Fatalf("CreatePerspective: %v", err)
	}
	if err := a.SetAtlasSession(AtlasSessionState{ActivePerspectiveID: p.ID}); err != nil {
		t.Fatalf("SetAtlasSession: %v", err)
	}

	link, err := a.CreateLink(c1.ID, c2.ID, lk.ID, "")
	if err != nil {
		t.Fatalf("CreateLink: %v", err)
	}
	var got atlas.Perspective
	for _, got2 := range a.Perspectives() {
		if got2.ID == p.ID {
			got = got2
		}
	}
	if !containsID(got.MemberLinkIDs, link.ID) {
		t.Errorf("active perspective's MemberLinkIDs = %v, want the freshly created link %q", got.MemberLinkIDs, link.ID)
	}
}

func TestPromoteNote_JoinsActivePerspective(t *testing.T) {
	a := newBlankAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	note, err := a.CreateNote("promote me", atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateNote: %v", err)
	}
	p, err := a.CreatePerspective("", "Current", "")
	if err != nil {
		t.Fatalf("CreatePerspective: %v", err)
	}
	if err := a.SetAtlasSession(AtlasSessionState{ActivePerspectiveID: p.ID}); err != nil {
		t.Fatalf("SetAtlasSession: %v", err)
	}

	promoted, err := a.PromoteNote(note.ID, k.ID, "Promoted")
	if err != nil {
		t.Fatalf("PromoteNote: %v", err)
	}
	var got atlas.Perspective
	for _, got2 := range a.Perspectives() {
		if got2.ID == p.ID {
			got = got2
		}
	}
	if !containsID(got.MemberCardIDs, promoted.ID) {
		t.Errorf("active perspective's MemberCardIDs = %v, want the newly promoted card %q", got.MemberCardIDs, promoted.ID)
	}
}

// --- Delete-of-owning-space cascade ---

func TestDeleteCard_CascadesOwningSpacePerspectiveDeletion(t *testing.T) {
	a := newBlankAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	space, err := a.CreateCard(k.ID, "Space", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(space): %v", err)
	}
	p, err := a.CreatePerspective(space.ID, "Current", "")
	if err != nil {
		t.Fatalf("CreatePerspective: %v", err)
	}
	if _, err := a.DeleteCard(space.ID); err != nil {
		t.Fatalf("DeleteCard: %v", err)
	}
	for _, got := range a.Perspectives() {
		if got.ID == p.ID {
			t.Error("DeleteCard on a perspective's own space did not cascade-delete the perspective")
		}
	}
}

// --- Purge integration ---

func TestPurgeTombstonesLocked_StripsPurgedMembersFromPerspectives(t *testing.T) {
	a := newBlankAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	cardA, err := a.CreateCard(k.ID, "A", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(A): %v", err)
	}
	cardB, err := a.CreateCard(k.ID, "B", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(B): %v", err)
	}
	lk, err := a.CreateLinkKind("relates to", "")
	if err != nil {
		t.Fatalf("CreateLinkKind: %v", err)
	}
	link, err := a.CreateLink(cardA.ID, cardB.ID, lk.ID, "")
	if err != nil {
		t.Fatalf("CreateLink: %v", err)
	}
	p, err := a.CreatePerspective("", "Current", "")
	if err != nil {
		t.Fatalf("CreatePerspective: %v", err)
	}
	if _, err := a.AddToPerspective(p.ID, cardA.ID); err != nil {
		t.Fatalf("AddToPerspective(A): %v", err)
	}
	if _, err := a.AddToPerspective(p.ID, cardB.ID); err != nil {
		t.Fatalf("AddToPerspective(B): %v", err)
	}
	// MemberLinkIDs has no public "add existing link" RPC in this slice
	// (only the authoring-while-active hook populates it) -- poke it
	// directly, same pattern the existing purge tests use for DeletedAt.
	a.mu.Lock()
	a.perspectives[a.findPerspectiveLocked(p.ID)].MemberLinkIDs = []string{link.ID}
	a.mu.Unlock()

	now := time.Now()
	a.mu.Lock()
	a.cards[a.findCardLocked(cardB.ID)].DeletedAt = now.Add(-tombstoneGraceWindow - time.Minute)
	changed := a.purgeTombstonesLocked(now)
	a.mu.Unlock()
	if !changed {
		t.Fatal("purgeTombstonesLocked reported no change")
	}

	var got atlas.Perspective
	for _, got2 := range a.Perspectives() {
		if got2.ID == p.ID {
			got = got2
		}
	}
	if containsID(got.MemberCardIDs, cardB.ID) {
		t.Errorf("perspective's MemberCardIDs after purge = %v, want the purged card %q stripped", got.MemberCardIDs, cardB.ID)
	}
	if !containsID(got.MemberCardIDs, cardA.ID) {
		t.Errorf("perspective's MemberCardIDs after purge = %v, want the surviving card %q kept", got.MemberCardIDs, cardA.ID)
	}
	if containsID(got.MemberLinkIDs, link.ID) {
		t.Errorf("perspective's MemberLinkIDs after purge = %v, want the now-gone link %q stripped", got.MemberLinkIDs, link.ID)
	}
}

// --- Export/Import ---

func TestExportImportAtlas_RoundTripsPerspectiveMembership(t *testing.T) {
	source := NewAtlasService(servicetest.NewFakeStore())
	k, err := source.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	spaceCard, err := source.CreateCard(k.ID, "Space", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(space): %v", err)
	}
	member, err := source.CreateCard(k.ID, "Member", "", nil, spaceCard.ID, nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(member): %v", err)
	}
	lk, err := source.CreateLinkKind("relates to", "")
	if err != nil {
		t.Fatalf("CreateLinkKind: %v", err)
	}
	link, err := source.CreateLink(spaceCard.ID, member.ID, lk.ID, "")
	if err != nil {
		t.Fatalf("CreateLink: %v", err)
	}
	p, err := source.CreatePerspective(spaceCard.ID, "Current", "the live system")
	if err != nil {
		t.Fatalf("CreatePerspective: %v", err)
	}
	if _, err := source.AddToPerspective(p.ID, member.ID); err != nil {
		t.Fatalf("AddToPerspective: %v", err)
	}
	source.mu.Lock()
	source.perspectives[source.findPerspectiveLocked(p.ID)].MemberLinkIDs = []string{link.ID}
	source.mu.Unlock()

	data, err := source.ExportAtlas()
	if err != nil {
		t.Fatalf("ExportAtlas: %v", err)
	}

	target := NewAtlasService(servicetest.NewFakeStore())
	if _, err := target.ImportAtlas(data); err != nil {
		t.Fatalf("ImportAtlas: %v", err)
	}

	var got atlas.Perspective
	found := false
	for _, got2 := range target.Perspectives() {
		if got2.ID == p.ID {
			got, found = got2, true
		}
	}
	if !found {
		t.Fatalf("imported perspective %q not found", p.ID)
	}
	if got.SpaceID != spaceCard.ID {
		t.Errorf("imported perspective's SpaceID = %q, want %q", got.SpaceID, spaceCard.ID)
	}
	if !containsID(got.MemberCardIDs, member.ID) {
		t.Errorf("imported perspective's MemberCardIDs = %v, want %q", got.MemberCardIDs, member.ID)
	}
	if !containsID(got.MemberLinkIDs, link.ID) {
		t.Errorf("imported perspective's MemberLinkIDs = %v, want %q", got.MemberLinkIDs, link.ID)
	}
}

func TestImportAtlas_FiltersUnknownPerspectiveMembers(t *testing.T) {
	a := NewAtlasService(servicetest.NewFakeStore())
	bundle := `{"schema":"mill://schema/atlas/v1","perspectives":[{"name":"Current","order":0,"memberCardIDs":["phantom-card"],"memberLinkIDs":["phantom-link"]}]}`
	if _, err := a.ImportAtlas(bundle); err != nil {
		t.Fatalf("ImportAtlas: %v", err)
	}
	var got atlas.Perspective
	found := false
	for _, p := range a.Perspectives() {
		if p.Name == "Current" {
			got, found = p, true
		}
	}
	if !found {
		t.Fatal("imported perspective not found")
	}
	if len(got.MemberCardIDs) != 0 {
		t.Errorf("imported perspective's MemberCardIDs = %v, want empty (unknown member filtered out)", got.MemberCardIDs)
	}
	if len(got.MemberLinkIDs) != 0 {
		t.Errorf("imported perspective's MemberLinkIDs = %v, want empty (unknown member filtered out)", got.MemberLinkIDs)
	}
}

// --- dataevent ---

func TestDataEvent_PerspectiveMutatorsEmit(t *testing.T) {
	a := newBlankAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	root, err := a.CreateCard(k.ID, "Root", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	child, err := a.CreateCard(k.ID, "Child", "", nil, root.ID, nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}

	got := captureEmits(t)
	p, err := a.CreatePerspective(root.ID, "Current", "")
	if err != nil {
		t.Fatalf("CreatePerspective: %v", err)
	}
	assertEmitted(t, *got, p.ID)

	got = captureEmits(t)
	if _, err := a.RenamePerspective(p.ID, "Current v2", ""); err != nil {
		t.Fatalf("RenamePerspective: %v", err)
	}
	assertEmitted(t, *got, p.ID)

	got = captureEmits(t)
	if _, err := a.AddToPerspective(p.ID, child.ID); err != nil {
		t.Fatalf("AddToPerspective: %v", err)
	}
	assertEmitted(t, *got, p.ID)

	got = captureEmits(t)
	if _, err := a.RemoveFromPerspective(p.ID, child.ID); err != nil {
		t.Fatalf("RemoveFromPerspective: %v", err)
	}
	assertEmitted(t, *got, p.ID)

	got = captureEmits(t)
	if err := a.ReorderPerspective(root.ID, []string{p.ID}); err != nil {
		t.Fatalf("ReorderPerspective: %v", err)
	}
	assertEmitted(t, *got, root.ID)

	got = captureEmits(t)
	if err := a.DeletePerspective(p.ID); err != nil {
		t.Fatalf("DeletePerspective: %v", err)
	}
	assertEmitted(t, *got, p.ID)
}
