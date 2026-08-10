package executionsvc

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// docs/goals/0010 item 4: Lists had zero seeded example and zero
// seeded workflow using list-lookup before this. These two tests run
// the REAL "Example: Country code lookup" seed against a real DBOS
// runtime, covering both halves of list-lookup's own "onMiss" config
// (composition/listlookup.go): a match, and a miss (which fails the
// run under the seed's default "fail" onMiss setting).

// newListLookupSeedHarness wires composition.SetListLookup to
// list.BuiltIn()'s own real seeded entries -- SetListLookup is wired by
// ConfigureService in production; this package never constructs one, so
// composition's default ("no list lookup registered") would otherwise
// reject every run. Restored after the test so it can't leak into
// other test files in this package (composition.SetListLookup is a
// package-level var, same shape swapHTTPRequestLookup already handles
// for the guarded-HTTP seed tests).
func newListLookupSeedHarness(t *testing.T) (*ExecutionService, string) {
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

	composition.SetListLookup(func(id string) (composition.ResolvedList, error) {
		for _, l := range list.BuiltIn() {
			if l.ID == id {
				return composition.ResolvedList{Entries: l.Entries}, nil
			}
		}
		return composition.ResolvedList{}, fmt.Errorf("no list with id %q", id)
	})
	t.Cleanup(func() {
		composition.SetListLookup(func(listID string) (composition.ResolvedList, error) {
			return composition.ResolvedList{}, fmt.Errorf("no list lookup registered (yet) for id %q", listID)
		})
	})

	wfID := findBuiltInWorkflowID(t, comp, "Example: Country code lookup")
	return exec, wfID
}

func TestSeededCountryLookupExample_Match_WritesCountryAttribute(t *testing.T) {
	exec, wfID := newListLookupSeedHarness(t)

	summary, err := exec.RunWorkflow(wfID, RunKindTest, map[string]string{"code": "US"})
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.Status != "SUCCESS" {
		t.Fatalf("RunWorkflow(code=US) status = %q, want SUCCESS -- error: %s", summary.Status, summary.Error)
	}
	if summary.Output != "US" {
		t.Errorf("RunWorkflow(code=US) output = %q, want %q (capture-attribute's own output, the code itself)", summary.Output, "US")
	}
}

func TestSeededCountryLookupExample_NoMatch_FailsClosed(t *testing.T) {
	exec, wfID := newListLookupSeedHarness(t)

	summary, err := exec.RunWorkflow(wfID, RunKindTest, map[string]string{"code": "ZZ"})
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.Status != "ERROR" {
		t.Fatalf("RunWorkflow(code=ZZ, no match) status = %q, want ERROR (the seed's default onMiss=\"fail\")", summary.Status)
	}
	if !strings.Contains(summary.Error, "no entry for") {
		t.Errorf("RunWorkflow(code=ZZ) error = %q, want list-lookup's own no-match error", summary.Error)
	}
}
