package atlassvc

import (
	"testing"
	"time"
)

// The out-of-package door seam (goal 0352): a mutation door in another
// service records into this same actor-scoped journal, and consecutive
// edits to one target fold into a single step.

func recordCell(a *AtlasService, key string, applied *[]string, undoValue, redoValue string) {
	a.RecordExternalUndo("list-cell", key, "Prices", key,
		func() error { *applied = append(*applied, undoValue); return nil },
		func() error { *applied = append(*applied, redoValue); return nil },
	)
}

func TestRecordExternalUndo_FoldsConsecutiveEditsToOneTarget(t *testing.T) {
	a := newTestAtlasService(t)
	var applied []string

	recordCell(a, "cell-a", &applied, "first-undo", "first-redo")
	recordCell(a, "cell-a", &applied, "second-undo", "second-redo")

	if res := a.Undo(); !res.Applied {
		t.Fatalf("Undo = %+v, want applied", res)
	}
	if len(applied) != 1 || applied[0] != "first-undo" {
		t.Fatalf("applied = %v, want [first-undo] -- a fold keeps the FIRST undo", applied)
	}
	if a.UndoState().HasUndo {
		t.Error("two edits to one cell left two steps on the journal")
	}

	if res := a.Redo(); !res.Applied {
		t.Fatalf("Redo = %+v, want applied", res)
	}
	if len(applied) != 2 || applied[1] != "second-redo" {
		t.Errorf("applied = %v, want the LAST redo second", applied)
	}
}

func TestRecordExternalUndo_DoesNotFoldPastTheWindow(t *testing.T) {
	a := newTestAtlasService(t)
	var applied []string

	recordCell(a, "cell-a", &applied, "first-undo", "first-redo")
	ageTopEntry(a, undoCoalesceWindow+time.Second)
	recordCell(a, "cell-a", &applied, "second-undo", "second-redo")

	a.Undo()
	a.Undo()
	if len(applied) != 2 || applied[0] != "second-undo" || applied[1] != "first-undo" {
		t.Errorf("applied = %v, want [second-undo first-undo] -- an edit outside the fold window is its own step", applied)
	}
}

func TestRecordExternalUndo_DifferentTargetsNeverFold(t *testing.T) {
	a := newTestAtlasService(t)
	var applied []string

	recordCell(a, "cell-a", &applied, "a-undo", "a-redo")
	recordCell(a, "cell-b", &applied, "b-undo", "b-redo")

	a.Undo()
	a.Undo()
	if len(applied) != 2 || applied[0] != "b-undo" || applied[1] != "a-undo" {
		t.Errorf("applied = %v, want [b-undo a-undo]", applied)
	}
}

func TestRecordExternalUndo_NoCoalesceKeyRecordsEveryCall(t *testing.T) {
	a := newTestAtlasService(t)
	var applied []string

	for range 3 {
		a.RecordExternalUndo("list-row", "row-1", "Prices", "",
			func() error { applied = append(applied, "undo"); return nil },
			func() error { applied = append(applied, "redo"); return nil },
		)
	}
	for range 3 {
		a.Undo()
	}
	if len(applied) != 3 {
		t.Errorf("applied %d inverses, want 3 -- an entry with no coalesce key never folds", len(applied))
	}
}

// A replayed inverse writes through the recording door again; the
// journal's suppression must stop it minting a second entry.
func TestRecordExternalUndo_ReplayRecordsNothing(t *testing.T) {
	a := newTestAtlasService(t)
	var replays int

	a.RecordExternalUndo("list-cell", "cell-a", "Prices", "cell-a",
		func() error {
			replays++
			a.RecordExternalUndo("list-cell", "cell-a", "Prices", "cell-a", func() error { return nil }, func() error { return nil })
			return nil
		},
		func() error { return nil },
	)

	a.Undo()
	if replays != 1 {
		t.Fatalf("replays = %d, want 1", replays)
	}
	if a.UndoState().HasUndo {
		t.Error("the replay's own write left a fresh entry on the undo stack")
	}
}

// A failing inverse is skipped with ADR-0044 decision 5's notice,
// naming the entity rather than an internal id.
func TestRecordExternalUndo_FailingInverseSkipsWithANotice(t *testing.T) {
	a := newTestAtlasService(t)
	a.RecordExternalUndo("list-cell", "cell-a", "Prices", "",
		func() error { return errGone },
		func() error { return nil },
	)

	res := a.Undo()
	if !res.Applied || !res.Skipped {
		t.Fatalf("Undo = %+v, want applied and skipped", res)
	}
	if res.Message == "" {
		t.Error("a skipped replay reported no notice")
	}
}

var errGone = errSkipped("its row is gone")

type errSkipped string

func (e errSkipped) Error() string { return string(e) }

// ageTopEntry backdates the newest UI entry's fold clock, so a test can
// cross the coalesce window without waiting it out.
func ageTopEntry(a *AtlasService, by time.Duration) {
	a.mu.Lock()
	defer a.mu.Unlock()
	stack := a.undoStacks[actorUI]
	stack[len(stack)-1].recordedAt = stack[len(stack)-1].recordedAt.Add(-by)
}
