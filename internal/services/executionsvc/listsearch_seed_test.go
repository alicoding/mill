package executionsvc

import (
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// docs/goals/0011-lists-maturation.md item 4: list-search's own seeded
// proof, run against a real DBOS runtime -- the "Example: Country
// lookup (search)" workflow, exercising an exact match hit and a miss
// against the SAME typed "Example: Country codes" List
// listlookup_seed_test.go already proves list-lookup against. Same
// harness shape as that file (composition.SetListLookup wired to
// list.BuiltIn(), restored via t.Cleanup).

func newListSearchSeedHarness(t *testing.T) (*ExecutionService, string) {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	guard := guardrailsvc.NewGuardrailService(store, comp)
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })

	composition.SetListLookup(func(id string, pinnedVersion int) (composition.ResolvedList, error) {
		for _, l := range list.BuiltIn() {
			if l.ID == id {
				resolved, err := list.Resolve(l, pinnedVersion)
				if err != nil {
					return composition.ResolvedList{}, err
				}
				withResolved := l
				withResolved.Columns, withResolved.Rows = resolved.Columns, resolved.Rows
				return composition.ResolvedList{
					Entries: list.DeriveEntries(withResolved), Columns: resolved.Columns, Rows: resolved.Rows,
					VersionStamp: resolved.VersionStamp,
				}, nil
			}
		}
		return composition.ResolvedList{}, fmt.Errorf("no list with id %q", id)
	})
	t.Cleanup(func() {
		composition.SetListLookup(func(listID string, _ int) (composition.ResolvedList, error) {
			return composition.ResolvedList{}, fmt.Errorf("no list lookup registered (yet) for id %q", listID)
		})
	})

	wfID := findBuiltInWorkflowID(t, comp, "Example: Country lookup (search)")
	return exec, wfID
}

func TestSeededListSearchExample_Match_WritesTypedResult(t *testing.T) {
	exec, wfID := newListSearchSeedHarness(t)

	summary, err := exec.RunWorkflow(wfID, RunKindTest, map[string]string{"code": "US"})
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.Status != "SUCCESS" {
		t.Fatalf("RunWorkflow(code=US) status = %q, want SUCCESS -- error: %s", summary.Status, summary.Error)
	}
	// The seed ends AT list-search itself (no terminal apply step --
	// a real Linux-CI clipboard failure caught during goal 0011's own
	// PR is why, see builtinworkflows_list.go), so the workflow's
	// final Payload/Output is still whatever capture-attribute set it
	// to; list-search's own typed result lives in the 'searchResult'
	// Attribute, not the string Payload/Output, proven at the
	// composition-unit-test layer (listsearch_test.go) rather than
	// re-asserted here.
	if summary.Output != "US" {
		t.Errorf("RunWorkflow(code=US) output = %q, want %q", summary.Output, "US")
	}
}

func TestSeededListSearchExample_NoMatch_WritesUnmatchedResult(t *testing.T) {
	exec, wfID := newListSearchSeedHarness(t)

	// Unlike list-lookup's onMiss="fail" default, list-search never
	// fails the run on a miss -- it always writes a typed
	// {matched:false, results:[], ...} object and lets the workflow
	// continue (a Decision downstream would branch on it).
	summary, err := exec.RunWorkflow(wfID, RunKindTest, map[string]string{"code": "ZZ"})
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.Status != "SUCCESS" {
		t.Fatalf("RunWorkflow(code=ZZ, no match) status = %q, want SUCCESS (list-search never fails on a miss) -- error: %s", summary.Status, summary.Error)
	}
	if summary.Output != "ZZ" {
		t.Errorf("RunWorkflow(code=ZZ) output = %q, want %q", summary.Output, "ZZ")
	}
}

func TestSeededListSearchExample_ExpiredRow_ExcludedByDefault(t *testing.T) {
	exec, wfID := newListSearchSeedHarness(t)

	// SU (Soviet Union) is seeded as a deliberately Expired row
	// (internal/domain/list.BuiltIn) -- an exact match against it
	// should behave exactly like a miss under the seed's default
	// includeExpired=false.
	summary, err := exec.RunWorkflow(wfID, RunKindTest, map[string]string{"code": "SU"})
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.Status != "SUCCESS" {
		t.Fatalf("RunWorkflow(code=SU, expired row) status = %q, want SUCCESS -- error: %s", summary.Status, summary.Error)
	}
}
