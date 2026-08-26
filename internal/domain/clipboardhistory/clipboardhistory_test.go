package clipboardhistory

import (
	"testing"
	"time"
)

func entryAt(id string, minutesAgo int, pinned bool) Entry {
	return Entry{ID: id, Text: id, CreatedAt: time.Now().Add(-time.Duration(minutesAgo) * time.Minute), Pinned: pinned}
}

func TestEvict_NoOpUnderCap(t *testing.T) {
	entries := []Entry{entryAt("a", 1, false), entryAt("b", 2, false)}
	got := Evict(entries)
	if len(got) != 2 {
		t.Errorf("Evict() under MaxUnpinned dropped entries, got %d, want 2", len(got))
	}
}

func TestEvict_DropsOldestUnpinnedOverCap(t *testing.T) {
	var entries []Entry
	for i := 0; i < MaxUnpinned+3; i++ {
		entries = append(entries, entryAt(string(rune('a'+i)), i, false))
	}
	got := Evict(entries)
	if len(got) != MaxUnpinned {
		t.Fatalf("Evict() = %d entries, want exactly MaxUnpinned (%d)", len(got), MaxUnpinned)
	}
	// The 3 entries with the largest minutesAgo (oldest) must be gone;
	// the newest MaxUnpinned must all survive.
	for _, e := range got {
		if e.ID == string(rune('a'+MaxUnpinned)) || e.ID == string(rune('a'+MaxUnpinned+1)) || e.ID == string(rune('a'+MaxUnpinned+2)) {
			t.Errorf("Evict() kept an entry (%s) that should have been the oldest overflow", e.ID)
		}
	}
}

func TestEvict_NeverDropsPinned(t *testing.T) {
	var entries []Entry
	for i := 0; i < MaxUnpinned+10; i++ {
		entries = append(entries, entryAt(string(rune('a'+i%26)), i, true))
	}
	got := Evict(entries)
	if len(got) != len(entries) {
		t.Errorf("Evict() dropped %d pinned entries, want zero dropped regardless of count", len(entries)-len(got))
	}
}

func TestEvict_MixedPinnedAndUnpinned(t *testing.T) {
	entries := []Entry{
		entryAt("pinned-old", 500, true),
		entryAt("unpinned-old", 500, false),
		entryAt("unpinned-new", 1, false),
	}
	// Force overflow with a small cap-equivalent scenario by padding
	// unpinned entries past MaxUnpinned.
	for i := 0; i < MaxUnpinned; i++ {
		entries = append(entries, entryAt("pad-"+string(rune('a'+i%26))+string(rune('0'+i/26)), 2+i, false))
	}
	got := Evict(entries)

	foundPinnedOld := false
	foundUnpinnedOld := false
	for _, e := range got {
		if e.ID == "pinned-old" {
			foundPinnedOld = true
		}
		if e.ID == "unpinned-old" {
			foundUnpinnedOld = true
		}
	}
	if !foundPinnedOld {
		t.Error("Evict() dropped a pinned entry despite unpinned overflow -- pinned entries must never be evicted")
	}
	if foundUnpinnedOld {
		t.Error("Evict() kept the oldest unpinned entry despite overflow -- it should have been the first dropped")
	}
}

func TestSortForDisplay_PinnedFloatsAboveUnpinned(t *testing.T) {
	entries := []Entry{
		entryAt("unpinned-new", 1, false),
		entryAt("pinned-old", 100, true),
		entryAt("unpinned-old", 200, false),
	}
	got := SortForDisplay(entries)
	if got[0].ID != "pinned-old" {
		t.Errorf("SortForDisplay()[0] = %s, want the pinned entry first regardless of age", got[0].ID)
	}
}

func TestSortForDisplay_NewestFirstWithinGroup(t *testing.T) {
	entries := []Entry{
		entryAt("older", 10, false),
		entryAt("newer", 1, false),
	}
	got := SortForDisplay(entries)
	if got[0].ID != "newer" || got[1].ID != "older" {
		t.Errorf("SortForDisplay() order = [%s, %s], want [newer, older]", got[0].ID, got[1].ID)
	}
}

func TestSortForDisplay_DoesNotMutateInput(t *testing.T) {
	entries := []Entry{entryAt("a", 1, false), entryAt("b", 2, false)}
	original := append([]Entry(nil), entries...)
	_ = SortForDisplay(entries)
	for i := range entries {
		if entries[i] != original[i] {
			t.Error("SortForDisplay() mutated its input slice, want the caller's slice left untouched")
		}
	}
}
