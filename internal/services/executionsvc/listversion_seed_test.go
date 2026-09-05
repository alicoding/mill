package executionsvc

import (
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// newListVersionExecHarness mirrors newDecisionExecHarness
// (decisionoutcome_seed_test.go) exactly -- a real ConfigureService
// (real seeded Lists, real composition.SetListLookup/SetApplyListRow
// wiring) plus a real ExecutionService, so this test proves the
// regression through the actual stack, not a hand-rolled fake.
func newListVersionExecHarness(t *testing.T) (*configuresvc.ConfigureService, *ExecutionService) {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, credential.NewInMemory())
	guard := guardrailsvc.NewGuardrailService(store, comp)
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })
	return cfg, exec
}

type listSearchResultPayload struct {
	Matched         bool   `json:"matched"`
	MatchCount      int    `json:"match_count"`
	ResolvedVersion string `json:"resolved_version"`
}

// TestSeededTaskTrackerExample_PinnedSearch_ResolvesFrozenV1AfterLiveWrite
// is docs/goals/0070's List-versioning regression (docs/adr/0040
// decisions 4-5, extended to List): a version-pinned list-search node
// keeps resolving the PINNED v1 snapshot after apply-list-row appends a
// new row to the live "Engagement tasks" List -- proven on the
// exact seeded workflows that ship this pin ("Engagement tasks
// (pinned to v1)" searching for the row "Track an engagement task"
// creates), through a real ExecutionService run, mirroring
// TestSeededBranchToDecisionExample_PinnedApproveArm_ResolvesFrozenV1AfterLiveEdit.
func TestSeededTaskTrackerExample_PinnedSearch_ResolvesFrozenV1AfterLiveWrite(t *testing.T) {
	cfg, exec := newListVersionExecHarness(t)

	var tracker list.List
	for _, l := range cfg.Lists() {
		if l.ID == list.ExampleTaskTrackerID {
			tracker = l
		}
	}
	if tracker.ID == "" {
		t.Fatal("seeded Task tracker List not found")
	}
	if tracker.PublishedVersion != 1 {
		t.Fatalf("seeded Task tracker List PublishedVersion = %d, want 1", tracker.PublishedVersion)
	}

	pinnedWfID := findBuiltInWorkflowID(t, exec.comp, "Engagement tasks (pinned to v1)")
	runPinnedSearch := func() listSearchResultPayload {
		t.Helper()
		summary, err := exec.RunWorkflow(pinnedWfID, RunKindTest, nil)
		if err != nil {
			t.Fatalf("RunWorkflow (pinned search): %v", err)
		}
		if summary.Status != "SUCCESS" {
			t.Fatalf("run status = %q (error: %q), want SUCCESS", summary.Status, summary.Error)
		}
		detail, err := exec.GetRun(summary.RunID)
		if err != nil {
			t.Fatalf("GetRun: %v", err)
		}
		for _, step := range detail.Steps {
			if step.NodeTypeID != "list-search" {
				continue
			}
			raw, err := json.Marshal(step.OutputAttributes["pinnedResult"])
			if err != nil {
				t.Fatalf("marshal pinnedResult: %v", err)
			}
			var out listSearchResultPayload
			if err := json.Unmarshal(raw, &out); err != nil {
				t.Fatalf("pinnedResult is not the expected shape: %v (%s)", err, raw)
			}
			return out
		}
		t.Fatal("no recorded list-search step")
		return listSearchResultPayload{}
	}

	// Before any live write: v1 has only "Set up Mill" -- searching for
	// "Ship goal 0070" (a row that doesn't exist yet anywhere) is a
	// legitimate miss either way, so this run alone doesn't distinguish
	// pinned from live. The real proof is the SECOND run below.
	before := runPinnedSearch()
	if before.Matched {
		t.Fatalf("pinned v1 search matched before the row was ever written: %+v", before)
	}
	if before.ResolvedVersion != "v1" {
		t.Errorf("resolved_version = %q, want v1", before.ResolvedVersion)
	}

	// Live write: the write-path workflow appends "Ship goal 0070" to
	// the LIVE draft, past v1's frozen row set.
	writeWfID := findBuiltInWorkflowID(t, exec.comp, "Track an engagement task")
	writeSummary, err := exec.RunWorkflow(writeWfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow (write path): %v", err)
	}
	if writeSummary.Status != "SUCCESS" {
		t.Fatalf("write-path run status = %q (error: %q), want SUCCESS", writeSummary.Status, writeSummary.Error)
	}

	// The pinned search must STILL miss -- the live-only row must never
	// leak into a v1-pinned resolution.
	after := runPinnedSearch()
	if after.Matched {
		t.Fatalf("pinned v1 search matched a row written to the LIVE draft AFTER publish: %+v", after)
	}
	if after.ResolvedVersion != "v1" {
		t.Errorf("resolved_version = %q, want v1 (unaffected by the live write)", after.ResolvedVersion)
	}

	// The live draft itself DOES see the new row -- confirms the miss
	// above is the pin working, not a broken write.
	var liveRows int
	for _, l := range cfg.Lists() {
		if l.ID == list.ExampleTaskTrackerID {
			liveRows = len(l.Rows)
		}
	}
	if liveRows != 2 {
		t.Errorf("live Task tracker has %d rows after the write-path run, want 2 (the seed row + the written one)", liveRows)
	}
}
