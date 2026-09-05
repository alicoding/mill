package executionsvc

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// TestSeededCardCreateLinkExample_CreatesFindsAndLinksCards runs the
// real seeded "Log a client request and its decision" workflow
// (composition.builtInAtlasCardWorkflows) end to end against a real
// AtlasService -- goal 0066's seeded proof for apply-atlas-card-create,
// process-atlas-card-find, and apply-atlas-card-link together.
// Manual-triggered, so RunKindTest (the draft head) is enough; no
// publish/arm needed.
func TestSeededCardCreateLinkExample_CreatesFindsAndLinksCards(t *testing.T) {
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

	var seed composition.Workflow
	for _, wf := range comp.Workflows() {
		if wf.Label == "Log a client request and its decision" {
			seed = wf
		}
	}
	if seed.ID == "" {
		t.Fatal(`no built-in workflow labeled "Log a client request and its decision"`)
	}

	baselineLinks := len(atlasSvc.Links())

	summary, err := exec.RunWorkflow(seed.ID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.Status != "SUCCESS" {
		t.Fatalf("summary = %+v, want SUCCESS", summary)
	}

	cards := atlasSvc.CardsByKind("atlas-kind-intake")
	if len(cards) != 2 {
		t.Fatalf("CardsByKind(atlas-kind-intake) = %d cards, want 2 (the two apply-atlas-card-create steps)", len(cards))
	}
	links := atlasSvc.Links()
	if len(links) != baselineLinks+1 {
		t.Fatalf("Links() = %d, want %d (the seeded baseline plus the apply-atlas-card-link step's own new link)", len(links), baselineLinks+1)
	}
	var newLink *string
	for _, l := range links {
		if l.FromCardID == cards[0].ID || l.FromCardID == cards[1].ID {
			id := l.ID
			newLink = &id
		}
	}
	if newLink == nil {
		t.Fatal("no link found connecting either created card")
	}
}
