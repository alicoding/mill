package list

import (
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/typedfield"
)

func versionedList() List {
	l := List{
		ID: "list-1", Label: "V1 label",
		Columns: []typedfield.Field{{Key: "code", Label: "Code", Type: typedfield.TypeText}},
		Rows:    []Row{{ID: "row-1", Values: map[string]string{"code": "US"}, Status: RowActive}},
	}
	l = PublishHead(l, time.Unix(1000, 0))
	// Edit the draft after publishing -- adding a row is a real
	// live-only change; the published v1 snapshot must stay exactly as
	// it was.
	l.Rows = append(l.Rows, Row{ID: "row-2", Values: map[string]string{"code": "CA"}, Status: RowActive})
	return l
}

func TestSnapshotHead_NumbersMonotonically_EvenAfterRepublishingOld(t *testing.T) {
	l := versionedList()                   // has v1
	l = PublishHead(l, time.Unix(2000, 0)) // v2
	l.PublishedVersion = 1                 // roll back the pointer
	snap := SnapshotHead(l, time.Unix(3000, 0))
	if snap.Version != 3 {
		t.Errorf("next version after rollback = %d, want 3 (max existing + 1, never reusing a number)", snap.Version)
	}
}

// The core immutability guarantee (docs/adr/0040 decision 4, applied to
// List by goal 0070): mutating the live draft's Rows after Publish
// never reaches back and changes the frozen v1 snapshot.
func TestPublishHead_SnapshotStaysImmutableAfterLaterDraftEdits(t *testing.T) {
	l := versionedList()
	v1, ok := VersionByNumber(l, 1)
	if !ok {
		t.Fatal("VersionByNumber(1) not found")
	}
	if len(v1.Rows) != 1 {
		t.Errorf("v1 snapshot has %d rows, want 1 (the row added to the draft AFTER publish must not appear)", len(v1.Rows))
	}
	if len(l.Rows) != 2 {
		t.Errorf("live draft has %d rows, want 2 (its own post-publish edit)", len(l.Rows))
	}
}

// Resolve is the one seam docs/adr/0040 decisions 4-5 require (List's
// own version, goal 0070): pinned resolution returns the frozen
// snapshot; unpinned resolution returns the current draft, unaffected
// by whether/when it was published -- the pre-versioning behavior,
// unchanged. This is the pinned-survives-live-edit regression, mirrored
// from decision.TestResolveOutcome_Unpinned_ReturnsLiveDraftNotThePublishedSnapshot.
func TestResolve_Unpinned_ReturnsLiveDraftNotThePublishedSnapshot(t *testing.T) {
	l := versionedList()
	got, err := Resolve(l, 0)
	if err != nil {
		t.Fatalf("Resolve(unpinned): %v", err)
	}
	if len(got.Rows) != 2 {
		t.Errorf("unpinned resolution has %d rows, want 2 (the live draft, including the post-publish edit)", len(got.Rows))
	}
	if got.VersionStamp != "live@1" {
		t.Errorf("unpinned VersionStamp = %q, want live@1 (published once, draft has since moved past it)", got.VersionStamp)
	}
}

func TestResolve_Pinned_ReturnsFrozenSnapshot(t *testing.T) {
	l := versionedList()
	got, err := Resolve(l, 1)
	if err != nil {
		t.Fatalf("Resolve(pinned 1): %v", err)
	}
	if len(got.Rows) != 1 {
		t.Errorf("pinned resolution has %d rows, want 1 (v1's own frozen shape, never the live draft's later edit)", len(got.Rows))
	}
	if got.VersionStamp != "v1" {
		t.Errorf("pinned VersionStamp = %q, want v1", got.VersionStamp)
	}
}

func TestResolve_PinToMissingVersion_Rejected(t *testing.T) {
	l := versionedList()
	if _, err := Resolve(l, 99); err == nil || !strings.Contains(err.Error(), "no version 99") {
		t.Errorf("Resolve(pinned 99): err = %v, want a missing-version rejection", err)
	}
}

// A List that has never been published resolves its draft with an
// honest "live@draft" stamp -- never a claim that a frozen version N
// was used when none exists yet.
func TestResolve_NeverPublished_StampsLiveDraft(t *testing.T) {
	l := List{ID: "list-2", Label: "Never published"}
	got, err := Resolve(l, 0)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got.VersionStamp != "live@draft" {
		t.Errorf("VersionStamp = %q, want live@draft", got.VersionStamp)
	}
}
