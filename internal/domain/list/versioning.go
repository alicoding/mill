package list

import (
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/domain/versioning"
)

// ListVersion is one immutable snapshot of a List's schema+data
// (docs/adr/0040 decision 4, goal 0070) -- the same draft/publish shape
// decision.DecisionVersion gives Decision, built on the shared
// internal/domain/versioning mechanism rather than a second hand-rolled
// copy of the numbering/lookup logic.
type ListVersion struct {
	Version int
	SavedAt time.Time
	Columns []typedfield.Field
	Rows    []Row
}

func (v ListVersion) VersionNumber() int { return v.Version }

// SnapshotHead captures l's current draft (Columns+Rows) as the next
// version number.
func SnapshotHead(l List, now time.Time) ListVersion {
	return ListVersion{
		Version: versioning.NextNumber(l.Versions),
		SavedAt: now,
		Columns: l.Columns,
		Rows:    l.Rows,
	}
}

// PublishHead appends a snapshot of the draft head and points
// PublishedVersion at it -- the audit-stamp reference point Resolve
// reads for a "live@N" run stamp. Unlike Workflow's PublishHead, this
// does NOT change what unpinned resolution returns (Resolve always
// reads the live draft below) -- see that function's own doc comment,
// mirroring decision.PublishHead exactly.
func PublishHead(l List, now time.Time) List {
	snap := SnapshotHead(l, now)
	l.Versions = append(l.Versions, snap)
	l.PublishedVersion = snap.Version
	return l
}

// VersionByNumber finds one snapshot.
func VersionByNumber(l List, n int) (ListVersion, bool) {
	return versioning.ByNumber(l.Versions, n)
}

// ResolvedSnapshot is the Columns/Rows a list-lookup/list-search node
// execution should read, plus the audit stamp the run records alongside
// it (mirrors decision.ResolvedOutcome, docs/adr/0040 decisions 4-5).
type ResolvedSnapshot struct {
	Columns []typedfield.Field
	Rows    []Row
	// VersionStamp is "v<N>" for a pinned resolution, "live@<N>" for an
	// unpinned resolution against a List published at least once, or
	// "live@draft" when the List has never been published -- identical
	// convention to decision.ResolvedOutcome.VersionStamp.
	VersionStamp string
}

// Resolve is the ONE seam that decides live-vs-pinned resolution for a
// List's READ path (list-lookup/list-search) -- mirrors
// decision.ResolveOutcome:
//   - pinnedVersion > 0: that exact published snapshot, frozen at
//     Publish time -- unaffected by any later row/column edit.
//   - pinnedVersion == 0 (unset): the List's own current draft
//     (Columns+Rows), the pre-versioning behavior, unchanged.
//
// apply-list-row's WRITE path never calls this -- a write always
// targets the live draft, never a frozen snapshot (docs/goals/0070).
func Resolve(l List, pinnedVersion int) (ResolvedSnapshot, error) {
	if pinnedVersion > 0 {
		v, ok := VersionByNumber(l, pinnedVersion)
		if !ok {
			return ResolvedSnapshot{}, fmt.Errorf("list %q has no version %d to pin to", l.Label, pinnedVersion)
		}
		return ResolvedSnapshot{Columns: v.Columns, Rows: v.Rows, VersionStamp: fmt.Sprintf("v%d", v.Version)}, nil
	}
	stamp := "live@draft"
	if l.PublishedVersion > 0 {
		stamp = fmt.Sprintf("live@%d", l.PublishedVersion)
	}
	return ResolvedSnapshot{Columns: l.Columns, Rows: l.Rows, VersionStamp: stamp}, nil
}
