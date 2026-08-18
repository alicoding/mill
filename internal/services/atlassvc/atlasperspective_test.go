package atlassvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
)

// --- Perspective CRUD ---

func TestCreatePerspective_RoundTrips(t *testing.T) {
	a := newBlankAtlasService(t)
	p, err := a.CreatePerspective("", "Current", "the live system")
	if err != nil {
		t.Fatalf("CreatePerspective: %v", err)
	}
	found := false
	for _, got := range a.Perspectives() {
		if got.ID == p.ID {
			found = true
			if got.Name != "Current" || got.Description != "the live system" {
				t.Errorf("Perspectives()'s round-tripped perspective = %+v", got)
			}
		}
	}
	if !found {
		t.Error("CreatePerspective's perspective is not present in Perspectives()")
	}
}

func TestCreatePerspective_UnknownSpace_Errors(t *testing.T) {
	a := newBlankAtlasService(t)
	if _, err := a.CreatePerspective("does-not-exist", "Current", ""); err == nil {
		t.Error("CreatePerspective() with an unknown space id = nil error, want an error")
	}
}

func TestCreatePerspective_BlankName_Errors(t *testing.T) {
	a := newBlankAtlasService(t)
	if _, err := a.CreatePerspective("", "  ", ""); err == nil {
		t.Error("CreatePerspective() with a blank name = nil error, want an error")
	}
}

func TestCreatePerspective_OrdersAppendPerSpace(t *testing.T) {
	a := newBlankAtlasService(t)
	first, err := a.CreatePerspective("", "Current", "")
	if err != nil {
		t.Fatalf("CreatePerspective: %v", err)
	}
	second, err := a.CreatePerspective("", "Target", "")
	if err != nil {
		t.Fatalf("CreatePerspective: %v", err)
	}
	if first.Order != 0 || second.Order != 1 {
		t.Errorf("Order = %d, %d, want 0, 1 (append within the same space)", first.Order, second.Order)
	}
}

func TestRenamePerspective_RoundTrips(t *testing.T) {
	a := newBlankAtlasService(t)
	p, err := a.CreatePerspective("", "Current", "")
	if err != nil {
		t.Fatalf("CreatePerspective: %v", err)
	}
	renamed, err := a.RenamePerspective(p.ID, "Target", "the future system")
	if err != nil {
		t.Fatalf("RenamePerspective: %v", err)
	}
	if renamed.Name != "Target" || renamed.Description != "the future system" {
		t.Errorf("RenamePerspective result = %+v, want Name/Description updated", renamed)
	}
}

func TestRenamePerspective_UnknownID_Errors(t *testing.T) {
	a := newBlankAtlasService(t)
	if _, err := a.RenamePerspective("does-not-exist", "x", ""); err == nil {
		t.Error("RenamePerspective() on an unknown id = nil error, want an error")
	}
}

func TestReorderPerspective_RoundTrips(t *testing.T) {
	a := newBlankAtlasService(t)
	first, err := a.CreatePerspective("", "Current", "")
	if err != nil {
		t.Fatalf("CreatePerspective: %v", err)
	}
	second, err := a.CreatePerspective("", "Target", "")
	if err != nil {
		t.Fatalf("CreatePerspective: %v", err)
	}
	if err := a.ReorderPerspective("", []string{second.ID, first.ID}); err != nil {
		t.Fatalf("ReorderPerspective: %v", err)
	}
	byID := make(map[string]atlas.Perspective)
	for _, p := range a.Perspectives() {
		byID[p.ID] = p
	}
	if byID[second.ID].Order != 0 || byID[first.ID].Order != 1 {
		t.Errorf("orders after reorder = %d, %d, want 0, 1", byID[second.ID].Order, byID[first.ID].Order)
	}
}

func TestReorderPerspective_WrongSet_Errors(t *testing.T) {
	a := newBlankAtlasService(t)
	p, err := a.CreatePerspective("", "Current", "")
	if err != nil {
		t.Fatalf("CreatePerspective: %v", err)
	}
	if err := a.ReorderPerspective("", []string{p.ID, "phantom"}); err == nil {
		t.Error("ReorderPerspective() naming an unknown id = nil error, want an error")
	}
	if err := a.ReorderPerspective("", []string{}); err == nil {
		t.Error("ReorderPerspective() naming too few ids = nil error, want an error")
	}
}

func TestDeletePerspective_RemovesIt(t *testing.T) {
	a := newBlankAtlasService(t)
	p, err := a.CreatePerspective("", "Current", "")
	if err != nil {
		t.Fatalf("CreatePerspective: %v", err)
	}
	if err := a.DeletePerspective(p.ID); err != nil {
		t.Fatalf("DeletePerspective: %v", err)
	}
	for _, got := range a.Perspectives() {
		if got.ID == p.ID {
			t.Error("DeletePerspective did not remove the perspective")
		}
	}
}

func TestDeletePerspective_UnknownID_Errors(t *testing.T) {
	a := newBlankAtlasService(t)
	if err := a.DeletePerspective("does-not-exist"); err == nil {
		t.Error("DeletePerspective() on an unknown id = nil error, want an error")
	}
}

// --- Membership ---

func TestAddToPerspective_ClosesAncestry(t *testing.T) {
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
	grandchild, err := a.CreateCard(k.ID, "Grandchild", "", nil, child.ID, nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(grandchild): %v", err)
	}
	p, err := a.CreatePerspective(root.ID, "Current", "")
	if err != nil {
		t.Fatalf("CreatePerspective: %v", err)
	}

	got, err := a.AddToPerspective(p.ID, grandchild.ID)
	if err != nil {
		t.Fatalf("AddToPerspective: %v", err)
	}
	if !containsID(got.MemberCardIDs, child.ID) || !containsID(got.MemberCardIDs, grandchild.ID) {
		t.Errorf("AddToPerspective's MemberCardIDs = %v, want both %q and %q (ancestry closure)", got.MemberCardIDs, child.ID, grandchild.ID)
	}
	if containsID(got.MemberCardIDs, root.ID) {
		t.Errorf("AddToPerspective's MemberCardIDs = %v, want NOT to include the space %q itself", got.MemberCardIDs, root.ID)
	}
}

func TestAddToPerspective_CardOutsideSpace_Errors(t *testing.T) {
	a := newBlankAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	root, err := a.CreateCard(k.ID, "Root", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(root): %v", err)
	}
	other, err := a.CreateCard(k.ID, "Other", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(other): %v", err)
	}
	p, err := a.CreatePerspective(root.ID, "Current", "")
	if err != nil {
		t.Fatalf("CreatePerspective: %v", err)
	}
	if _, err := a.AddToPerspective(p.ID, other.ID); err == nil {
		t.Error("AddToPerspective() with a card outside the perspective's space = nil error, want an error")
	}
}

func TestRemoveFromPerspective_CascadesToDescendants(t *testing.T) {
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
	grandchild, err := a.CreateCard(k.ID, "Grandchild", "", nil, child.ID, nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(grandchild): %v", err)
	}
	p, err := a.CreatePerspective(root.ID, "Current", "")
	if err != nil {
		t.Fatalf("CreatePerspective: %v", err)
	}
	if _, err := a.AddToPerspective(p.ID, grandchild.ID); err != nil {
		t.Fatalf("AddToPerspective: %v", err)
	}

	got, err := a.RemoveFromPerspective(p.ID, child.ID)
	if err != nil {
		t.Fatalf("RemoveFromPerspective: %v", err)
	}
	if containsID(got.MemberCardIDs, child.ID) || containsID(got.MemberCardIDs, grandchild.ID) {
		t.Errorf("RemoveFromPerspective's MemberCardIDs = %v, want neither %q nor its descendant %q (cascade)", got.MemberCardIDs, child.ID, grandchild.ID)
	}
}

func TestRemoveFromPerspective_UnknownPerspective_Errors(t *testing.T) {
	a := newBlankAtlasService(t)
	if _, err := a.RemoveFromPerspective("does-not-exist", "some-card"); err == nil {
		t.Error("RemoveFromPerspective() on an unknown perspective = nil error, want an error")
	}
}

// --- Session ---

func TestAtlasSession_ActivePerspective_Degrades(t *testing.T) {
	a := newBlankAtlasService(t)
	p, err := a.CreatePerspective("", "Current", "")
	if err != nil {
		t.Fatalf("CreatePerspective: %v", err)
	}
	if err := a.SetAtlasSession(AtlasSessionState{ActivePerspectiveID: p.ID}); err != nil {
		t.Fatalf("SetAtlasSession: %v", err)
	}
	if got := a.AtlasSession().ActivePerspectiveID; got != p.ID {
		t.Fatalf("AtlasSession().ActivePerspectiveID = %q, want %q", got, p.ID)
	}

	if err := a.DeletePerspective(p.ID); err != nil {
		t.Fatalf("DeletePerspective: %v", err)
	}
	if got := a.AtlasSession().ActivePerspectiveID; got != "" {
		t.Errorf("AtlasSession().ActivePerspectiveID after the active perspective was deleted = %q, want \"\" (degraded)", got)
	}
}

// --- Diff (goal 0095 slice 3) ---

func TestDiffPerspectives_ReportsAddedAndRemovedMembers(t *testing.T) {
	a := newBlankAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	lk, err := a.CreateLinkKind("relates to", "")
	if err != nil {
		t.Fatalf("CreateLinkKind: %v", err)
	}
	root, err := a.CreateCard(k.ID, "Root", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(root): %v", err)
	}
	x, err := a.CreateCard(k.ID, "X", "", nil, root.ID, nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(x): %v", err)
	}
	y, err := a.CreateCard(k.ID, "Y", "", nil, root.ID, nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(y): %v", err)
	}

	from, err := a.CreatePerspective(root.ID, "From", "")
	if err != nil {
		t.Fatalf("CreatePerspective(from): %v", err)
	}
	if _, err := a.AddToPerspective(from.ID, x.ID); err != nil {
		t.Fatalf("AddToPerspective: %v", err)
	}
	to, err := a.CreatePerspective(root.ID, "To", "")
	if err != nil {
		t.Fatalf("CreatePerspective(to): %v", err)
	}
	if _, err := a.AddToPerspective(to.ID, y.ID); err != nil {
		t.Fatalf("AddToPerspective: %v", err)
	}
	if _, err := a.AddToPerspective(to.ID, x.ID); err != nil {
		t.Fatalf("AddToPerspective: %v", err)
	}

	// Authoring-while-active is the only path that joins a LINK to a
	// perspective in this slice -- activate "to" so creating the link
	// here auto-joins it there, never "from".
	if err := a.SetAtlasSession(AtlasSessionState{ActivePerspectiveID: to.ID}); err != nil {
		t.Fatalf("SetAtlasSession: %v", err)
	}
	link, err := a.CreateLink(x.ID, y.ID, lk.ID, "")
	if err != nil {
		t.Fatalf("CreateLink: %v", err)
	}

	diff, err := a.DiffPerspectives(from.ID, to.ID)
	if err != nil {
		t.Fatalf("DiffPerspectives: %v", err)
	}
	if !containsID(diff.AddedCardIDs, y.ID) || containsID(diff.AddedCardIDs, x.ID) {
		t.Errorf("AddedCardIDs = %v, want exactly %q", diff.AddedCardIDs, y.ID)
	}
	if len(diff.RemovedCardIDs) != 0 {
		t.Errorf("RemovedCardIDs = %v, want none (x stays a member of both)", diff.RemovedCardIDs)
	}
	// The link touches y, which only becomes a member of "to" -- so it
	// only starts rendering there, an added link, never removed.
	if !containsID(diff.AddedLinkIDs, link.ID) {
		t.Errorf("AddedLinkIDs = %v, want %q", diff.AddedLinkIDs, link.ID)
	}
	if len(diff.RemovedLinkIDs) != 0 {
		t.Errorf("RemovedLinkIDs = %v, want none", diff.RemovedLinkIDs)
	}
}

func TestDiffPerspectives_UnknownID_Errors(t *testing.T) {
	a := newBlankAtlasService(t)
	p, err := a.CreatePerspective("", "Current", "")
	if err != nil {
		t.Fatalf("CreatePerspective: %v", err)
	}
	if _, err := a.DiffPerspectives("does-not-exist", p.ID); err == nil {
		t.Error("DiffPerspectives() with an unknown 'from' id = nil error, want an error")
	}
	if _, err := a.DiffPerspectives(p.ID, "does-not-exist"); err == nil {
		t.Error("DiffPerspectives() with an unknown 'to' id = nil error, want an error")
	}
}

func containsID(ids []string, id string) bool {
	for _, got := range ids {
		if got == id {
			return true
		}
	}
	return false
}
