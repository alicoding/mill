package atlassvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
)

func setupUndoKind(t *testing.T, a *AtlasService) atlas.Kind {
	t.Helper()
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	return k
}

// TestUndo_CreateFamily_UndoRemovesRedoRestores pins the create family's
// inverse pair (ADR-0044): ⌘Z removes a just-created card, ⇧⌘Z brings
// it back with the same id.
func TestUndo_CreateFamily_UndoRemovesRedoRestores(t *testing.T) {
	a := newTestAtlasService(t)
	k := setupUndoKind(t, a)

	c, err := a.CreateCard(k.ID, "Fresh", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}

	res := a.Undo()
	if !res.Applied || res.Skipped {
		t.Fatalf("Undo() = %+v, want Applied and not Skipped", res)
	}
	for _, card := range a.Cards() {
		if card.ID == c.ID {
			t.Fatalf("card %q still present after Undo()", c.ID)
		}
	}

	res = a.Redo()
	if !res.Applied || res.Skipped {
		t.Fatalf("Redo() = %+v, want Applied and not Skipped", res)
	}
	found := false
	for _, card := range a.Cards() {
		if card.ID == c.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("card %q missing after Redo()", c.ID)
	}
}

// TestUndo_DeleteFamily_UndoRestoresTombstoneAndSeed pins the delete
// family's inverse: undoing a delete clears the tombstone (the card is
// live again) exactly like the pre-existing UndoDelete contract, and a
// built-in card's seed tombstone clears too so reconcile can top it up
// again -- Undo() must not weaken 0093's existing guarantee.
func TestUndo_DeleteFamily_UndoRestoresTombstoneAndSeed(t *testing.T) {
	a := newTestAtlasService(t)
	k := setupUndoKind(t, a)
	c, err := a.CreateCard(k.ID, "Doomed", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}

	if _, err := a.DeleteCard(c.ID); err != nil {
		t.Fatalf("DeleteCard: %v", err)
	}
	for _, card := range a.Cards() {
		if card.ID == c.ID {
			t.Fatalf("card %q still live after DeleteCard", c.ID)
		}
	}

	res := a.Undo()
	if !res.Applied || res.Skipped {
		t.Fatalf("Undo() = %+v, want Applied and not Skipped", res)
	}
	found := false
	for _, card := range a.Cards() {
		if card.ID == c.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("card %q not restored by Undo()", c.ID)
	}

	// Redo re-deletes through the exact same door.
	res = a.Redo()
	if !res.Applied || res.Skipped {
		t.Fatalf("Redo() = %+v, want Applied and not Skipped", res)
	}
	for _, card := range a.Cards() {
		if card.ID == c.ID {
			t.Fatalf("card %q still live after Redo() re-delete", c.ID)
		}
	}
}

// TestUndo_MoveFamily_UndoReturnsParent pins the move family's inverse:
// undoing a reparent returns the card to its original parent.
func TestUndo_MoveFamily_UndoReturnsParent(t *testing.T) {
	a := newTestAtlasService(t)
	k := setupUndoKind(t, a)
	parentA, err := a.CreateCard(k.ID, "ParentA", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard parentA: %v", err)
	}
	parentB, err := a.CreateCard(k.ID, "ParentB", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard parentB: %v", err)
	}
	child, err := a.CreateCard(k.ID, "Child", "", nil, parentA.ID, nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard child: %v", err)
	}

	if _, err := a.MoveCard(child.ID, parentB.ID); err != nil {
		t.Fatalf("MoveCard: %v", err)
	}

	res := a.Undo()
	if !res.Applied || res.Skipped {
		t.Fatalf("Undo() = %+v, want Applied and not Skipped", res)
	}
	var moved atlas.Card
	for _, card := range a.Cards() {
		if card.ID == child.ID {
			moved = card
		}
	}
	if moved.ParentID != parentA.ID {
		t.Fatalf("child.ParentID = %q after Undo(), want %q", moved.ParentID, parentA.ID)
	}
}

// TestUndo_ScalarFamily_UndoReturnsPriorValue pins the scalar family's
// inverse: undoing a position change (a card drag) returns the prior
// position -- the drag-end proof e2e exercises this same door.
func TestUndo_ScalarFamily_UndoReturnsPriorValue(t *testing.T) {
	a := newTestAtlasService(t)
	k := setupUndoKind(t, a)
	origin := atlas.Position{X: 10, Y: 20}
	c, err := a.CreateCard(k.ID, "Movable", "", nil, "", &origin, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	moved := atlas.Position{X: 300, Y: 400}
	if _, err := a.SetPosition(c.ID, &moved); err != nil {
		t.Fatalf("SetPosition: %v", err)
	}

	res := a.Undo()
	if !res.Applied || res.Skipped {
		t.Fatalf("Undo() = %+v, want Applied and not Skipped", res)
	}
	var found atlas.Card
	for _, card := range a.Cards() {
		if card.ID == c.ID {
			found = card
		}
	}
	if found.Position == nil || found.Position.X != origin.X || found.Position.Y != origin.Y {
		t.Fatalf("position after Undo() = %+v, want %+v", found.Position, origin)
	}

	res = a.Redo()
	if !res.Applied || res.Skipped {
		t.Fatalf("Redo() = %+v, want Applied and not Skipped", res)
	}
	for _, card := range a.Cards() {
		if card.ID == c.ID {
			if card.Position == nil || card.Position.X != moved.X || card.Position.Y != moved.Y {
				t.Fatalf("position after Redo() = %+v, want %+v", card.Position, moved)
			}
		}
	}
}

// TestUndo_PromoteFamily_UndoDemotes pins ADR-0044's own explicit
// promote family: undoing PromoteNote removes the promoted card and
// brings the original note back.
func TestUndo_PromoteFamily_UndoDemotes(t *testing.T) {
	a := newTestAtlasService(t)
	k := setupUndoKind(t, a)
	n, err := a.CreateNote("promote me", atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateNote: %v", err)
	}

	card, err := a.PromoteNote(n.ID, k.ID, "Promoted")
	if err != nil {
		t.Fatalf("PromoteNote: %v", err)
	}

	res := a.Undo()
	if !res.Applied || res.Skipped {
		t.Fatalf("Undo() = %+v, want Applied and not Skipped", res)
	}
	for _, c := range a.Cards() {
		if c.ID == card.ID {
			t.Fatalf("promoted card %q still present after Undo()", card.ID)
		}
	}
	found := false
	for _, note := range a.Notes() {
		if note.ID == n.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("note %q not restored by Undo() (demote)", n.ID)
	}

	// Redo re-promotes the same note into the same card id.
	res = a.Redo()
	if !res.Applied || res.Skipped {
		t.Fatalf("Redo() = %+v, want Applied and not Skipped", res)
	}
	found = false
	for _, c := range a.Cards() {
		if c.ID == card.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("card %q not restored by Redo() (repromote)", card.ID)
	}
}

// TestUndo_MultiDeleteMark_UndoesAsOneStep pins ADR-0044 decision 2:
// deleting several entities under one BeginUndoMark/EndUndoMark undoes
// in a SINGLE Undo() call, restoring every one of them together.
func TestUndo_MultiDeleteMark_UndoesAsOneStep(t *testing.T) {
	a := newTestAtlasService(t)
	k := setupUndoKind(t, a)
	c1, err := a.CreateCard(k.ID, "One", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard c1: %v", err)
	}
	c2, err := a.CreateCard(k.ID, "Two", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard c2: %v", err)
	}

	a.BeginUndoMark()
	if _, err := a.DeleteCard(c1.ID); err != nil {
		t.Fatalf("DeleteCard c1: %v", err)
	}
	if _, err := a.DeleteCard(c2.ID); err != nil {
		t.Fatalf("DeleteCard c2: %v", err)
	}
	a.EndUndoMark()

	// ONE Undo() call restores BOTH cards -- proof the pair moved as a
	// single step, not two.
	res := a.Undo()
	if !res.Applied || res.Skipped {
		t.Fatalf("Undo() = %+v, want Applied and not Skipped", res)
	}
	live := map[string]bool{}
	for _, c := range a.Cards() {
		live[c.ID] = true
	}
	if !live[c1.ID] || !live[c2.ID] {
		t.Fatalf("both cards should be live after ONE Undo(), live=%v", live)
	}
}

// TestUndo_MCPWrite_NeverEntersUIStack pins ADR-0044 decision 4: an
// MCP-approved write (CreateCardForMCP, mcpsvc's own executor door)
// must never be poppable by the UI actor's ⌘Z.
func TestUndo_MCPWrite_NeverEntersUIStack(t *testing.T) {
	a := newTestAtlasService(t)
	k := setupUndoKind(t, a)

	before := a.UndoState()
	if before.HasUndo {
		t.Fatalf("fresh service already reports HasUndo")
	}

	c, err := a.CreateCardForMCP(k.ID, "Agent card", "", nil, "")
	if err != nil {
		t.Fatalf("CreateCardForMCP: %v", err)
	}

	after := a.UndoState()
	if after.HasUndo {
		t.Fatalf("UndoState().HasUndo = true after an MCP-actor write; MCP writes must never enter the UI stack")
	}

	// Undo() (the UI actor's own pop) must be a no-op -- the card stays.
	res := a.Undo()
	if res.Applied {
		t.Fatalf("Undo() applied against an empty UI stack (MCP entry leaked in): %+v", res)
	}
	found := false
	for _, card := range a.Cards() {
		if card.ID == c.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("MCP-created card %q should still be live (never popped)", c.ID)
	}
}

// TestUndo_WorkflowWrite_NeverEntersUIStack is the actor-exclusion
// test's own workflow-actor counterpart (CreateCardForWorkflow, the
// pre-existing composition-engine door).
func TestUndo_WorkflowWrite_NeverEntersUIStack(t *testing.T) {
	a := newTestAtlasService(t)
	k := setupUndoKind(t, a)

	if _, err := a.CreateCardForWorkflow(k.ID, "Workflow card", "", nil, "run-1"); err != nil {
		t.Fatalf("CreateCardForWorkflow: %v", err)
	}
	if a.UndoState().HasUndo {
		t.Fatalf("UndoState().HasUndo = true after a workflow-actor write")
	}
}

// TestUndo_Staleness_SkipsWithNotice pins ADR-0044 decision 5's
// minimal v1: undoing an entry whose target was removed by someone
// else since is SKIPPED (the inverse call errors -- "no link with id
// ...") rather than panicking or corrupting state, and the result
// reports the skip. Uses a link (DeleteLink hard-removes, unlike a
// card/note/object's tombstone-only delete) so the target is
// genuinely gone from a.links, not just hidden.
func TestUndo_Staleness_SkipsWithNotice(t *testing.T) {
	a := newTestAtlasService(t)
	k := setupUndoKind(t, a)
	c1, err := a.CreateCard(k.ID, "From", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard c1: %v", err)
	}
	c2, err := a.CreateCard(k.ID, "To", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard c2: %v", err)
	}
	lk, err := a.CreateLinkKind("relates to", "")
	if err != nil {
		t.Fatalf("CreateLinkKind: %v", err)
	}
	link, err := a.CreateLink(c1.ID, c2.ID, lk.ID, "original")
	if err != nil {
		t.Fatalf("CreateLink: %v", err)
	}
	if _, err := a.UpdateLink(link.ID, "renamed"); err != nil {
		t.Fatalf("UpdateLink: %v", err)
	}

	// Someone else removes the link entirely, bypassing the journal
	// entirely (the same shape an out-of-band/MCP removal would leave):
	// the UpdateLink mark on top of the stack now targets a link that
	// no longer exists.
	a.mu.Lock()
	idx := a.findLinkLocked(link.ID)
	a.links = append(a.links[:idx], a.links[idx+1:]...)
	_ = a.persistLocked()
	a.mu.Unlock()

	res := a.Undo()
	if !res.Applied || !res.Skipped || res.Message == "" {
		t.Fatalf("Undo() over a stale target = %+v, want Applied+Skipped with a message", res)
	}
}
