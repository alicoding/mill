package decision

import (
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/versioning"
)

// DecisionVersion is one immutable snapshot of a Decision's
// schema-carrying definition (docs/adr/0040 decision 4) -- the same
// draft/publish shape composition.WorkflowVersion gives Workflow
// (ADR-0021), built on the shared internal/domain/versioning mechanism
// rather than a second hand-rolled copy of the numbering logic.
type DecisionVersion struct {
	Version          int
	SavedAt          time.Time
	Label            string
	Category         Category
	Outputs          []OutputField
	WebhookRequestID string
}

func (v DecisionVersion) VersionNumber() int { return v.Version }

// SnapshotHead captures d's current draft as the next version number.
func SnapshotHead(d Decision, now time.Time) DecisionVersion {
	return DecisionVersion{
		Version:          versioning.NextNumber(d.Versions),
		SavedAt:          now,
		Label:            d.Label,
		Category:         d.Category,
		Outputs:          d.Outputs,
		WebhookRequestID: d.WebhookRequestID,
	}
}

// PublishHead appends a snapshot of the draft head and points
// PublishedVersion at it -- the audit-stamp reference point ResolveOutcome
// reads for a "live@N" run stamp. Unlike Workflow's PublishHead, this
// does NOT change what unpinned resolution returns (ResolveOutcome
// always reads the live draft below) -- see that function's own doc
// comment.
func PublishHead(d Decision, now time.Time) Decision {
	snap := SnapshotHead(d, now)
	d.Versions = append(d.Versions, snap)
	d.PublishedVersion = snap.Version
	return d
}

// VersionByNumber finds one snapshot.
func VersionByNumber(d Decision, n int) (DecisionVersion, bool) {
	return versioning.ByNumber(d.Versions, n)
}

// ResolvedOutcome is the definition a decision-outcome node execution
// should use, plus the audit stamp the run records alongside it
// (docs/adr/0040 decision 5).
type ResolvedOutcome struct {
	Label            string
	Category         Category
	Outputs          []OutputField
	WebhookRequestID string
	// VersionStamp is "v<N>" for a pinned resolution, "live@<N>" for an
	// unpinned resolution against a Decision published at least once
	// (N = PublishedVersion at the moment this resolved, NOT necessarily
	// what the returned draft still looks like -- the draft may have
	// moved past N since), or "live@draft" when the Decision has never
	// been published. The honest reading of "live" here is "whatever
	// this Decision's draft currently says," same as ADR-0021's own
	// pre-versioning behavior -- VersionStamp is metadata about how far
	// that draft has drifted from the last publish, not a claim that a
	// frozen snapshot was used.
	VersionStamp string
}

// ResolveOutcome is the ONE seam that decides live-vs-pinned resolution
// (docs/adr/0040 decisions 4-5) -- every caller (decision-outcome's
// node exec, EffectForNode, NodeAlwaysParks) goes through this rather
// than re-deriving the choice:
//   - pinnedVersion > 0: that exact published snapshot, frozen at
//     Publish time -- unaffected by any later edit to the Decision's
//     draft.
//   - pinnedVersion == 0 (unset): the Decision's own current draft
//     fields -- the pre-ADR-0040 behavior, unchanged. This is NOT the
//     published snapshot: an edited-but-unpublished Decision still
//     resolves its edited draft, since a Decision (unlike a Workflow)
//     has no separate "test vs. triggered" run kind to gate on.
func ResolveOutcome(d Decision, pinnedVersion int) (ResolvedOutcome, error) {
	if pinnedVersion > 0 {
		v, ok := VersionByNumber(d, pinnedVersion)
		if !ok {
			return ResolvedOutcome{}, fmt.Errorf("decision %q has no version %d to pin to", d.Label, pinnedVersion)
		}
		return ResolvedOutcome{
			Label: v.Label, Category: v.Category, Outputs: v.Outputs, WebhookRequestID: v.WebhookRequestID,
			VersionStamp: fmt.Sprintf("v%d", v.Version),
		}, nil
	}
	stamp := "live@draft"
	if d.PublishedVersion > 0 {
		stamp = fmt.Sprintf("live@%d", d.PublishedVersion)
	}
	return ResolvedOutcome{
		Label: d.Label, Category: d.Category, Outputs: d.Outputs, WebhookRequestID: d.WebhookRequestID,
		VersionStamp: stamp,
	}, nil
}
