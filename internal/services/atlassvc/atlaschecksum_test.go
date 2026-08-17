package atlassvc

import (
	"path/filepath"
	"testing"
)

func TestFileChecksum_KnownContentProducesKnownHex(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "hello.txt")
	mustWriteFile(t, path, "hello world")

	got, err := fileChecksum(path)
	if err != nil {
		t.Fatalf("fileChecksum: %v", err)
	}
	// sha256("hello world"), lowercase hex -- a fixed, independently
	// verifiable known-answer value.
	const want = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
	if got != want {
		t.Errorf("fileChecksum(%q) = %q, want %q", path, got, want)
	}
}

func TestFileChecksum_MissingFileErrors(t *testing.T) {
	if _, err := fileChecksum(filepath.Join(t.TempDir(), "nope.txt")); err == nil {
		t.Error("fileChecksum() on a missing file = nil error, want an error")
	}
}

func TestChecksumIndexLocked_OnlyIncludesCardsWithAChecksum(t *testing.T) {
	a := newTestAtlasService(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "notes.md")
	mustWriteFile(t, path, "content")
	sum, err := fileChecksum(path)
	if err != nil {
		t.Fatalf("fileChecksum: %v", err)
	}

	result, err := a.CreateCardFromFileDrop(path, "notes", "", nil)
	if err != nil {
		t.Fatalf("CreateCardFromFileDrop: %v", err)
	}

	a.mu.RLock()
	index := a.checksumIndexLocked()
	a.mu.RUnlock()
	if index[sum] != result.Card.ID {
		t.Errorf("checksumIndexLocked()[%q] = %q, want the created card's own id %q", sum, index[sum], result.Card.ID)
	}

	// A seeded card carries no MirrorPath/MirrorChecksum -- it must
	// never appear in the index.
	for _, c := range a.Cards() {
		if c.ID == result.Card.ID {
			continue
		}
		if c.MirrorChecksum != "" {
			t.Fatalf("unexpected seeded card with a MirrorChecksum: %+v", c)
		}
	}
}

// TestBackfillMirrorChecksums_ComputesBoundedAndPersistsSkippingMissing
// proves the opportunistic backfill (goal 0088): an existing mirrored
// card with no checksum yet gets one computed and persisted, a card
// whose mirror file no longer exists is skipped without error, and the
// pass never touches more than mirrorChecksumBackfillCap cards.
func TestBackfillMirrorChecksums_ComputesBoundedAndPersistsSkippingMissing(t *testing.T) {
	a := newTestAtlasService(t)
	dir := t.TempDir()

	present := filepath.Join(dir, "present.md")
	mustWriteFile(t, present, "present content")
	wantSum, err := fileChecksum(present)
	if err != nil {
		t.Fatalf("fileChecksum: %v", err)
	}

	fileKind := firstKindWithLabel(t, a, "Document")
	presentCard, err := a.CreateCard(fileKind, "Present", "", nil, "", nil, "", "", present, "")
	if err != nil {
		t.Fatalf("CreateCard(present): %v", err)
	}
	if presentCard.MirrorChecksum != "" {
		t.Fatalf("freshly created card via CreateCard already carries a checksum: %+v", presentCard)
	}

	missing := filepath.Join(dir, "gone.md")
	missingCard, err := a.CreateCard(fileKind, "Gone", "", nil, "", nil, "", "", missing, "")
	if err != nil {
		t.Fatalf("CreateCard(missing): %v", err)
	}

	a.backfillMirrorChecksums()

	var gotPresent, gotMissing string
	for _, c := range a.Cards() {
		if c.ID == presentCard.ID {
			gotPresent = c.MirrorChecksum
		}
		if c.ID == missingCard.ID {
			gotMissing = c.MirrorChecksum
		}
	}
	if gotPresent != wantSum {
		t.Errorf("backfilled checksum = %q, want %q", gotPresent, wantSum)
	}
	if gotMissing != "" {
		t.Errorf("card with a missing mirror file got a checksum = %q, want it skipped (empty)", gotMissing)
	}

	// A second run must be a no-op (no error, checksum unchanged) --
	// the field is only ever computed once.
	a.backfillMirrorChecksums()
	for _, c := range a.Cards() {
		if c.ID == presentCard.ID && c.MirrorChecksum != wantSum {
			t.Errorf("second backfillMirrorChecksums() changed an already-computed checksum: got %q, want %q", c.MirrorChecksum, wantSum)
		}
	}
}
