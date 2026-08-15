package composition

import (
	"fmt"
	"time"
)

// Workflow lifecycle & versioning (docs/adr/0021): the workflow's own
// head Nodes/Edges/Attributes are the DRAFT (what the canvas edits);
// Versions holds immutable published-or-publishable snapshots; the
// PublishedVersion pointer is what triggers and child-workflow calls
// execute. Pure domain logic only -- storage/persistence stays in
// CompositionService per .claude/rules/backend.md.

// WorkflowVersion is one immutable snapshot of a workflow's definition.
type WorkflowVersion struct {
	Version     int
	SavedAt     time.Time
	Label       string
	Description string
	Nodes       []Node
	Edges       []Edge
	Notes       []Note
	Attributes  []AttributeDef
}

// SnapshotHead captures wf's current draft head as the next version
// number (monotonic: max existing + 1, so republishing old versions
// never collides).
func SnapshotHead(wf Workflow, now time.Time) WorkflowVersion {
	next := 1
	for _, v := range wf.Versions {
		if v.Version >= next {
			next = v.Version + 1
		}
	}
	return WorkflowVersion{
		Version:     next,
		SavedAt:     now,
		Label:       wf.Label,
		Description: wf.Description,
		Nodes:       wf.Nodes,
		Edges:       wf.Edges,
		Notes:       wf.Notes,
		Attributes:  wf.Attributes,
	}
}

// PublishHead appends a snapshot of the draft head and points
// PublishedVersion at it -- publish and live are one concept
// (ADR-0021, confirmed directly with the user).
func PublishHead(wf Workflow, now time.Time) Workflow {
	snap := SnapshotHead(wf, now)
	wf.Versions = append(wf.Versions, snap)
	wf.PublishedVersion = snap.Version
	return wf
}

// VersionByNumber finds one snapshot.
func VersionByNumber(wf Workflow, n int) (WorkflowVersion, bool) {
	for _, v := range wf.Versions {
		if v.Version == n {
			return v, true
		}
	}
	return WorkflowVersion{}, false
}

// ResolveRunnable returns the definition a run should execute
// (ADR-0021's resolution semantics):
//   - pinned > 0: that exact snapshot, regardless of the published
//     pointer (child-workflow version pinning).
//   - draft: the head as-is -- test runs, allowed even on a disabled
//     workflow (n8n's own semantics: disabling pauses production, not
//     debugging).
//   - otherwise: the published snapshot; rejected when the workflow is
//     disabled or has never been published -- going live is the
//     explicit act, not a side effect of saving (§8's fail-safe
//     posture applied to the lifecycle).
//
// The returned version number is what the run records (0 = draft).
func ResolveRunnable(wf Workflow, draft bool, pinned int) (nodes []Node, edges []Edge, attrs []AttributeDef, version int, err error) {
	if pinned > 0 {
		v, ok := VersionByNumber(wf, pinned)
		if !ok {
			return nil, nil, nil, 0, fmt.Errorf("workflow %q has no version %d to pin to", wf.Label, pinned)
		}
		if wf.Disabled {
			return nil, nil, nil, 0, fmt.Errorf("workflow %q is disabled -- enable it before invoking it", wf.Label)
		}
		return v.Nodes, v.Edges, v.Attributes, v.Version, nil
	}
	if draft {
		return wf.Nodes, wf.Edges, wf.Attributes, 0, nil
	}
	if wf.Disabled {
		return nil, nil, nil, 0, fmt.Errorf("workflow %q is disabled -- enable it before invoking it", wf.Label)
	}
	if wf.PublishedVersion == 0 {
		return nil, nil, nil, 0, fmt.Errorf("workflow %q has no published version -- publish it first (a test run exercises the draft without publishing)", wf.Label)
	}
	v, ok := VersionByNumber(wf, wf.PublishedVersion)
	if !ok {
		return nil, nil, nil, 0, fmt.Errorf("workflow %q's published version %d is missing", wf.Label, wf.PublishedVersion)
	}
	return v.Nodes, v.Edges, v.Attributes, v.Version, nil
}
