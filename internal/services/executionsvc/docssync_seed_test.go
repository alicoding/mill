package executionsvc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

const docsSyncWorkflowID = "example-docssync-workflow"

func newDocsSyncSeedFixture(t *testing.T) (*ExecutionService, *compositionsvc.CompositionService, *atlassvc.AtlasService) {
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
	atlasSvc := atlassvc.NewAtlasService(store)
	atlasSvc.WireCompositionSeams(func(string, string, string, string, string) {})
	return exec, comp, atlasSvc
}

// TestSeededDocsSyncExample_MirrorsFolderIdempotently proves the goal
// 0108 seed the way a user drives it: as shipped (empty folder path)
// the run fails with the honest folderPath-required error; after
// setting the path on the step, one run mirrors every markdown file
// under the parent card, and a second run creates nothing new.
func TestSeededDocsSyncExample_MirrorsFolderIdempotently(t *testing.T) {
	exec, comp, atlasSvc := newDocsSyncSeedFixture(t)

	// As shipped: the empty path refuses loudly, never a silent no-op.
	if summary, err := exec.RunWorkflow(docsSyncWorkflowID, RunKindTest, nil); err == nil && summary.Status == "SUCCESS" {
		t.Fatalf("as-shipped run = %+v, want the folderPath-required failure", summary)
	}

	dir := t.TempDir()
	for _, name := range []string{"containers.md", "flow-guardrail-run.md"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("# doc\n"), 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}

	// The user journey: set the folder path on the seeded step.
	var wf composition.Workflow
	for _, w := range comp.Workflows() {
		if w.ID == docsSyncWorkflowID {
			wf = w
		}
	}
	if wf.ID == "" {
		t.Fatal("seeded docs-sync workflow not found")
	}
	for i := range wf.Nodes {
		if wf.Nodes[i].NodeTypeID == "apply-atlas-docs-sync" {
			wf.Nodes[i].Config["folderPath"] = dir
		}
	}
	if _, err := comp.UpdateWorkflow(wf.ID, wf.Label, wf.Description, wf.Nodes, wf.Edges); err != nil {
		t.Fatalf("UpdateWorkflow: %v", err)
	}

	baseline := len(atlasSvc.Cards())
	summary, err := exec.RunWorkflow(docsSyncWorkflowID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.Status != "SUCCESS" {
		t.Fatalf("summary = %+v, want SUCCESS", summary)
	}
	cards := atlasSvc.Cards()
	// Two mirror cards plus the created "Synced docs" parent.
	if len(cards) != baseline+3 {
		t.Fatalf("got %d cards after first sync, want %d", len(cards), baseline+3)
	}
	var parentID string
	mirrors := 0
	for _, c := range cards {
		if c.Title == "Synced docs" {
			parentID = c.ID
		}
		if strings.HasPrefix(c.MirrorPath, dir) {
			mirrors++
		}
	}
	if parentID == "" || mirrors != 2 {
		t.Fatalf("parent %q / mirrors %d, want the parent and 2 mirror cards", parentID, mirrors)
	}

	// Idempotency: the second run changes nothing.
	if _, err := exec.RunWorkflow(docsSyncWorkflowID, RunKindTest, nil); err != nil {
		t.Fatalf("second RunWorkflow: %v", err)
	}
	if got := len(atlasSvc.Cards()); got != baseline+3 {
		t.Fatalf("got %d cards after second sync, want unchanged %d", got, baseline+3)
	}
}
