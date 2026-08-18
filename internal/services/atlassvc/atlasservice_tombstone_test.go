package atlassvc

import (
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// TestDeleteCard_SoftDeleteRoundTripsWithUndo pins goal 0093's core
// contract: a deleted card disappears from every read surface, and
// UndoDelete brings it back with its links intact -- nothing about the
// card or its links was ever rewritten, only a stamp cleared.
func TestDeleteCard_SoftDeleteRoundTripsWithUndo(t *testing.T) {
	a := newTestAtlasService(t)
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
	lk, err := a.CreateLinkKind("connects to", "")
	if err != nil {
		t.Fatalf("CreateLinkKind: %v", err)
	}
	link, err := a.CreateLink(c1.ID, c2.ID, lk.ID, "")
	if err != nil {
		t.Fatalf("CreateLink: %v", err)
	}

	result, err := a.DeleteCard(c1.ID)
	if err != nil {
		t.Fatalf("DeleteCard: %v", err)
	}
	if len(result.CardIDs) != 1 || result.CardIDs[0] != c1.ID {
		t.Fatalf("DeleteCard result = %+v, want CardIDs=[%q]", result, c1.ID)
	}
	for _, c := range a.Cards() {
		if c.ID == c1.ID {
			t.Error("deleted card still present in Cards()")
		}
	}
	for _, l := range a.Links() {
		if l.ID == link.ID {
			t.Error("a link touching a tombstoned card is still present in Links()")
		}
	}

	if err := a.UndoDelete(result.CardIDs, nil); err != nil {
		t.Fatalf("UndoDelete: %v", err)
	}
	found := false
	for _, c := range a.Cards() {
		if c.ID == c1.ID {
			found = true
		}
	}
	if !found {
		t.Error("UndoDelete did not restore the card")
	}
	linkFound := false
	for _, l := range a.Links() {
		if l.ID == link.ID {
			linkFound = true
		}
	}
	if !linkFound {
		t.Error("UndoDelete did not restore the card's link")
	}
}

// TestDeleteCard_TombstoneResultCounts_LeafWithLinks pins goal 0103's
// blast-radius counts for the simplest case: a leaf card with one live
// link and no children.
func TestDeleteCard_TombstoneResultCounts_LeafWithLinks(t *testing.T) {
	a := newTestAtlasService(t)
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
	lk, err := a.CreateLinkKind("connects to", "")
	if err != nil {
		t.Fatalf("CreateLinkKind: %v", err)
	}
	if _, err := a.CreateLink(c1.ID, c2.ID, lk.ID, ""); err != nil {
		t.Fatalf("CreateLink: %v", err)
	}

	result, err := a.DeleteCard(c1.ID)
	if err != nil {
		t.Fatalf("DeleteCard: %v", err)
	}
	if result.LinksRemoved != 1 {
		t.Errorf("LinksRemoved = %d, want 1", result.LinksRemoved)
	}
	if result.ChildrenPromoted != 0 {
		t.Errorf("ChildrenPromoted = %d, want 0", result.ChildrenPromoted)
	}
}

// TestDeleteCard_TombstoneResultCounts_ContainerWithChildrenAndLinks
// pins the container case: deleting a card with two direct live
// children (one card, one note) and one live link reports both counts
// together.
func TestDeleteCard_TombstoneResultCounts_ContainerWithChildrenAndLinks(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	container, err := a.CreateCard(k.ID, "Container", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(container): %v", err)
	}
	child, err := a.CreateCard(k.ID, "Child", "", nil, container.ID, nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(child): %v", err)
	}
	if _, err := a.CreateNote("filed under container", atlas.Position{}, container.ID); err != nil {
		t.Fatalf("CreateNote: %v", err)
	}
	other, err := a.CreateCard(k.ID, "Other", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(other): %v", err)
	}
	lk, err := a.CreateLinkKind("connects to", "")
	if err != nil {
		t.Fatalf("CreateLinkKind: %v", err)
	}
	if _, err := a.CreateLink(container.ID, other.ID, lk.ID, ""); err != nil {
		t.Fatalf("CreateLink: %v", err)
	}

	result, err := a.DeleteCard(container.ID)
	if err != nil {
		t.Fatalf("DeleteCard: %v", err)
	}
	if result.LinksRemoved != 1 {
		t.Errorf("LinksRemoved = %d, want 1", result.LinksRemoved)
	}
	if result.ChildrenPromoted != 2 {
		t.Errorf("ChildrenPromoted = %d, want 2 (one card + one note)", result.ChildrenPromoted)
	}

	gotChild, ok := findCardTestByID(a.Cards(), child.ID)
	if !ok || gotChild.ParentID != "" {
		t.Errorf("child not virtually promoted to top level, got %+v ok=%v", gotChild, ok)
	}
}

// TestDeleteCard_TombstoneResultCounts_MixedSelection pins the
// multi-delete case the frontend's own selection-delete flow drives:
// two independent DeleteCard calls in one batch (a leaf-with-a-link
// and a container-with-children), each reporting its own counts so
// the caller can sum them across the whole selection.
func TestDeleteCard_TombstoneResultCounts_MixedSelection(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	leaf, err := a.CreateCard(k.ID, "Leaf", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(leaf): %v", err)
	}
	leafFriend, err := a.CreateCard(k.ID, "LeafFriend", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(leafFriend): %v", err)
	}
	lk, err := a.CreateLinkKind("connects to", "")
	if err != nil {
		t.Fatalf("CreateLinkKind: %v", err)
	}
	if _, err := a.CreateLink(leaf.ID, leafFriend.ID, lk.ID, ""); err != nil {
		t.Fatalf("CreateLink: %v", err)
	}
	container, err := a.CreateCard(k.ID, "Container", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(container): %v", err)
	}
	if _, err := a.CreateCard(k.ID, "ContainerChild", "", nil, container.ID, nil, "", "", "", ""); err != nil {
		t.Fatalf("CreateCard(containerChild): %v", err)
	}

	leafResult, err := a.DeleteCard(leaf.ID)
	if err != nil {
		t.Fatalf("DeleteCard(leaf): %v", err)
	}
	containerResult, err := a.DeleteCard(container.ID)
	if err != nil {
		t.Fatalf("DeleteCard(container): %v", err)
	}

	totalLinksRemoved := leafResult.LinksRemoved + containerResult.LinksRemoved
	totalChildrenPromoted := leafResult.ChildrenPromoted + containerResult.ChildrenPromoted
	if totalLinksRemoved != 1 {
		t.Errorf("summed LinksRemoved = %d, want 1", totalLinksRemoved)
	}
	if totalChildrenPromoted != 1 {
		t.Errorf("summed ChildrenPromoted = %d, want 1", totalChildrenPromoted)
	}
}

// TestDeleteNote_SoftDeleteRoundTripsWithUndo is the same contract for
// notes.
func TestDeleteNote_SoftDeleteRoundTripsWithUndo(t *testing.T) {
	a := newTestAtlasService(t)
	n, err := a.CreateNote("gone soon", atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateNote: %v", err)
	}
	result, err := a.DeleteNote(n.ID)
	if err != nil {
		t.Fatalf("DeleteNote: %v", err)
	}
	if len(result.NoteIDs) != 1 || result.NoteIDs[0] != n.ID {
		t.Fatalf("DeleteNote result = %+v, want NoteIDs=[%q]", result, n.ID)
	}
	for _, got := range a.Notes() {
		if got.ID == n.ID {
			t.Error("deleted note still present in Notes()")
		}
	}
	if err := a.UndoDelete(nil, result.NoteIDs); err != nil {
		t.Fatalf("UndoDelete: %v", err)
	}
	found := false
	for _, got := range a.Notes() {
		if got.ID == n.ID {
			found = true
		}
	}
	if !found {
		t.Error("UndoDelete did not restore the note")
	}
}

// TestDeleteCard_ContainerTombstone_ChildrenResolveToEffectiveParent
// pins the design refinement superseding the goal file's static
// reparent: deleting a container never rewrites its children's
// ParentID -- Cards()/Notes() resolve their EFFECTIVE parent past the
// tombstone, and undo needs nothing more than clearing the stamp for
// the children to snap back under the container.
func TestDeleteCard_ContainerTombstone_ChildrenResolveToEffectiveParent(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	grandparent, err := a.CreateCard(k.ID, "Grandparent", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(grandparent): %v", err)
	}
	parent, err := a.CreateCard(k.ID, "Parent", "", nil, grandparent.ID, nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(parent): %v", err)
	}
	child, err := a.CreateCard(k.ID, "Child", "", nil, parent.ID, nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(child): %v", err)
	}
	note, err := a.CreateNote("filed under parent", atlas.Position{}, parent.ID)
	if err != nil {
		t.Fatalf("CreateNote: %v", err)
	}

	result, err := a.DeleteCard(parent.ID)
	if err != nil {
		t.Fatalf("DeleteCard(parent): %v", err)
	}

	gotChild, ok := findCardTestByID(a.Cards(), child.ID)
	if !ok {
		t.Fatalf("child card vanished after DeleteCard(parent)")
	}
	if gotChild.ParentID != grandparent.ID {
		t.Errorf("child.ParentID = %q, want virtually promoted to grandparent %q", gotChild.ParentID, grandparent.ID)
	}
	gotNote, ok := findNoteTestByID(a.Notes(), note.ID)
	if !ok {
		t.Fatalf("note vanished after DeleteCard(parent)")
	}
	if gotNote.ParentID != grandparent.ID {
		t.Errorf("note.ParentID = %q, want virtually promoted to grandparent %q", gotNote.ParentID, grandparent.ID)
	}

	// The stored ParentID must be untouched -- no data rewrite until
	// purge. White-box: same package, direct field access.
	a.mu.RLock()
	rawIdx := a.findCardLocked(child.ID)
	rawParentID := a.cards[rawIdx].ParentID
	a.mu.RUnlock()
	if rawParentID != parent.ID {
		t.Errorf("child's STORED ParentID = %q, want unchanged %q (virtual promotion only)", rawParentID, parent.ID)
	}

	if err := a.UndoDelete(result.CardIDs, nil); err != nil {
		t.Fatalf("UndoDelete: %v", err)
	}
	gotChild, ok = findCardTestByID(a.Cards(), child.ID)
	if !ok {
		t.Fatalf("child card vanished after undo")
	}
	if gotChild.ParentID != parent.ID {
		t.Errorf("after undo, child.ParentID = %q, want snapped back to %q", gotChild.ParentID, parent.ID)
	}
}

// TestPurgeTombstonesLocked_WindowEdge pins the 48h grace-window
// boundary directly: a tombstone exactly at the cutoff survives, one
// a moment past it is purged.
func TestPurgeTombstonesLocked_WindowEdge(t *testing.T) {
	a := NewAtlasService(servicetest.NewFakeStore())
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	survivor, err := a.CreateCard(k.ID, "Survivor", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	purged, err := a.CreateCard(k.ID, "Purged", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	now := time.Now()

	a.mu.Lock()
	a.cards[a.findCardLocked(survivor.ID)].DeletedAt = now.Add(-tombstoneGraceWindow + time.Minute)
	a.cards[a.findCardLocked(purged.ID)].DeletedAt = now.Add(-tombstoneGraceWindow - time.Minute)
	changed := a.purgeTombstonesLocked(now)
	a.mu.Unlock()

	if !changed {
		t.Fatal("purgeTombstonesLocked reported no change, want the past-window card purged")
	}
	a.mu.RLock()
	_, survivorStillThere := a.cardsByIDLocked()[survivor.ID]
	_, purgedGone := a.cardsByIDLocked()[purged.ID]
	a.mu.RUnlock()
	if !survivorStillThere {
		t.Error("a tombstone inside the grace window was purged")
	}
	if purgedGone {
		t.Error("a tombstone past the grace window survived purge")
	}
}

// TestPurgeTombstonesLocked_RepaentsSurvivingChildrenForReal is the
// counterpart to the virtual-promotion test above: once the grace
// window actually elapses, purge performs the REAL reparent so the
// tree stays connected once the bridging tombstone disappears.
func TestPurgeTombstonesLocked_RepaentsSurvivingChildrenForReal(t *testing.T) {
	a := NewAtlasService(servicetest.NewFakeStore())
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	grandparent, err := a.CreateCard(k.ID, "Grandparent", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(grandparent): %v", err)
	}
	parent, err := a.CreateCard(k.ID, "Parent", "", nil, grandparent.ID, nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(parent): %v", err)
	}
	child, err := a.CreateCard(k.ID, "Child", "", nil, parent.ID, nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(child): %v", err)
	}
	note, err := a.CreateNote("filed under parent", atlas.Position{}, parent.ID)
	if err != nil {
		t.Fatalf("CreateNote: %v", err)
	}

	now := time.Now()
	a.mu.Lock()
	a.cards[a.findCardLocked(parent.ID)].DeletedAt = now.Add(-tombstoneGraceWindow - time.Minute)
	changed := a.purgeTombstonesLocked(now)
	a.mu.Unlock()
	if !changed {
		t.Fatal("purgeTombstonesLocked reported no change")
	}

	a.mu.RLock()
	gotChildParentID := a.cards[a.findCardLocked(child.ID)].ParentID
	gotNoteParentID := a.notes[a.findNoteLocked(note.ID)].ParentID
	_, parentStillThere := a.cardsByIDLocked()[parent.ID]
	a.mu.RUnlock()
	if parentStillThere {
		t.Error("purge left the past-window tombstoned parent in place")
	}
	if gotChildParentID != grandparent.ID {
		t.Errorf("after purge, child's STORED ParentID = %q, want rewritten to %q", gotChildParentID, grandparent.ID)
	}
	if gotNoteParentID != grandparent.ID {
		t.Errorf("after purge, note's STORED ParentID = %q, want rewritten to %q", gotNoteParentID, grandparent.ID)
	}
}

// TestExportAtlas_ExcludesTombstonedCardsAndTheirLinks pins the
// export/share surface's own exclusion.
func TestExportAtlas_ExcludesTombstonedCardsAndTheirLinks(t *testing.T) {
	a := newBlankAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	c1, err := a.CreateCard(k.ID, "Keep", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	c2, err := a.CreateCard(k.ID, "Gone", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	lk, err := a.CreateLinkKind("connects to", "")
	if err != nil {
		t.Fatalf("CreateLinkKind: %v", err)
	}
	if _, err := a.CreateLink(c1.ID, c2.ID, lk.ID, ""); err != nil {
		t.Fatalf("CreateLink: %v", err)
	}
	if _, err := a.DeleteCard(c2.ID); err != nil {
		t.Fatalf("DeleteCard: %v", err)
	}

	exported, err := a.ExportAtlas()
	if err != nil {
		t.Fatalf("ExportAtlas: %v", err)
	}
	if strings.Contains(exported, "\"Gone\"") {
		t.Error("ExportAtlas included a tombstoned card")
	}
	if !strings.Contains(exported, "\"Keep\"") {
		t.Error("ExportAtlas dropped the live card too")
	}
}
