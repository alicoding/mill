package decision

import (
	"strings"
	"testing"
	"time"
)

func versionedDecision() Decision {
	d := Decision{
		ID: "dec-1", Label: "V1 label", Category: CategoryApprove,
		Outputs: []OutputField{{Key: "score", Label: "Score", Type: "number"}},
	}
	d = PublishHead(d, time.Unix(1000, 0))
	// Edit the draft after publishing -- an additive field (ADR-0040
	// decision 1 allows this in place; the published v1 snapshot must
	// stay exactly as it was).
	d.Outputs = append(d.Outputs, OutputField{Key: "note", Label: "Note", Type: "text"})
	return d
}

func TestSnapshotHead_NumbersMonotonically_EvenAfterRepublishingOld(t *testing.T) {
	d := versionedDecision()               // has v1
	d = PublishHead(d, time.Unix(2000, 0)) // v2
	d.PublishedVersion = 1                 // roll back the pointer
	snap := SnapshotHead(d, time.Unix(3000, 0))
	if snap.Version != 3 {
		t.Errorf("next version after rollback = %d, want 3 (max existing + 1, never reusing a number)", snap.Version)
	}
}

// The core immutability guarantee (docs/adr/0040 decision 4): mutating
// the live draft's Outputs after Publish never reaches back and
// changes the frozen v1 snapshot.
func TestPublishHead_SnapshotStaysImmutableAfterLaterDraftEdits(t *testing.T) {
	d := versionedDecision()
	v1, ok := VersionByNumber(d, 1)
	if !ok {
		t.Fatal("VersionByNumber(1) not found")
	}
	if len(v1.Outputs) != 1 {
		t.Errorf("v1 snapshot has %d outputs, want 1 (the field added to the draft AFTER publish must not appear)", len(v1.Outputs))
	}
	if len(d.Outputs) != 2 {
		t.Errorf("live draft has %d outputs, want 2 (its own post-publish edit)", len(d.Outputs))
	}
}

// ResolveOutcome is the one seam docs/adr/0040 decisions 4-5 require:
// pinned resolution returns the frozen snapshot; unpinned resolution
// returns the current draft, unaffected by whether/when it was
// published -- the pre-versioning behavior, unchanged.
func TestResolveOutcome_Unpinned_ReturnsLiveDraftNotThePublishedSnapshot(t *testing.T) {
	d := versionedDecision()
	got, err := ResolveOutcome(d, 0)
	if err != nil {
		t.Fatalf("ResolveOutcome(unpinned): %v", err)
	}
	if len(got.Outputs) != 2 {
		t.Errorf("unpinned resolution has %d outputs, want 2 (the live draft, including the post-publish edit)", len(got.Outputs))
	}
	if got.VersionStamp != "live@1" {
		t.Errorf("unpinned VersionStamp = %q, want live@1 (published once, draft has since moved past it)", got.VersionStamp)
	}
}

func TestResolveOutcome_Pinned_ReturnsFrozenSnapshot(t *testing.T) {
	d := versionedDecision()
	got, err := ResolveOutcome(d, 1)
	if err != nil {
		t.Fatalf("ResolveOutcome(pinned 1): %v", err)
	}
	if len(got.Outputs) != 1 {
		t.Errorf("pinned resolution has %d outputs, want 1 (v1's own frozen shape, never the live draft's later edit)", len(got.Outputs))
	}
	if got.VersionStamp != "v1" {
		t.Errorf("pinned VersionStamp = %q, want v1", got.VersionStamp)
	}
}

func TestResolveOutcome_PinToMissingVersion_Rejected(t *testing.T) {
	d := versionedDecision()
	if _, err := ResolveOutcome(d, 99); err == nil || !strings.Contains(err.Error(), "no version 99") {
		t.Errorf("ResolveOutcome(pinned 99): err = %v, want a missing-version rejection", err)
	}
}

// A Decision that has never been published resolves its draft with an
// honest "live@draft" stamp -- never a claim that a frozen version
// N was used when none exists yet.
func TestResolveOutcome_NeverPublished_StampsLiveDraft(t *testing.T) {
	d := Decision{ID: "dec-2", Label: "Never published", Category: CategoryDeny}
	got, err := ResolveOutcome(d, 0)
	if err != nil {
		t.Fatalf("ResolveOutcome: %v", err)
	}
	if got.VersionStamp != "live@draft" {
		t.Errorf("VersionStamp = %q, want live@draft", got.VersionStamp)
	}
}
