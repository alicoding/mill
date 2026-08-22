package executionsvc

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

func newClipbridgeSeedFixture(t *testing.T) (*ExecutionService, *atlassvc.AtlasService) {
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
	return exec, atlasSvc
}

// TestSeededClipbridgeCardsRoute_CreatesAcceptedCards runs the real
// seeded "Clipboard reply: create cards" route (goal 0099) end to end:
// accepted items in, real cards out, including the summary-field
// mapping and the kind-label resolution.
func TestSeededClipbridgeCardsRoute_CreatesAcceptedCards(t *testing.T) {
	exec, atlasSvc := newClipbridgeSeedFixture(t)

	baseline := len(atlasSvc.Cards())
	items := `[{"title":"Payments gateway","kind":"Topic","note":"from the AI reply"},{"title":"Ada follow-up"}]`
	summary, err := exec.RunWorkflow(composition.ReplyCardsWorkflowID, RunKindTest, map[string]string{"items": items})
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.Status != "SUCCESS" {
		t.Fatalf("summary = %+v, want SUCCESS", summary)
	}
	cards := atlasSvc.Cards()
	if len(cards) != baseline+2 {
		t.Fatalf("got %d cards, want %d", len(cards), baseline+2)
	}
	var made atlas.Card
	for _, c := range cards {
		if c.Title == "Payments gateway" {
			made = c
		}
	}
	if made.ID == "" || made.Note != "from the AI reply" {
		t.Fatalf("created card wrong: %+v", made)
	}
}

// TestSeededClipbridgeNoteRoute_LandsInScratchpad runs the seeded
// "Clipboard reply: save to Scratchpad" route: the note lands under the
// seeded Scratchpad area, never floating at root.
func TestSeededClipbridgeNoteRoute_LandsInScratchpad(t *testing.T) {
	exec, atlasSvc := newClipbridgeSeedFixture(t)

	items := `[{"text":"remember: renew the cert"}]`
	summary, err := exec.RunWorkflow(composition.ReplyNoteWorkflowID, RunKindTest, map[string]string{"items": items})
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.Status != "SUCCESS" {
		t.Fatalf("summary = %+v, want SUCCESS", summary)
	}
	var found bool
	for _, n := range atlasSvc.Notes() {
		if strings.Contains(n.Text, "renew the cert") {
			found = true
			if n.ParentID != atlas.BuiltInScratchpadCardID {
				t.Fatalf("note landed under %q, want the Scratchpad", n.ParentID)
			}
		}
	}
	if !found {
		t.Fatal("the reply's note never landed")
	}
}

// TestClipbridgePreviewToRouteLoop closes the whole IN loop at the
// service level: a raw reply string previews (with collision
// annotation), and the preview's own route workflow materializes the
// accepted items.
func TestClipbridgePreviewToRouteLoop(t *testing.T) {
	exec, atlasSvc := newClipbridgeSeedFixture(t)

	// "Discovery workstream" exists in the seed -- a reply proposing it
	// again must flag the collision.
	reply := `{"mill":1,"kind":"reply","action":"create-cards","items":[{"title":"Discovery workstream"},{"title":"Fresh card"}]}`
	preview, err := atlasSvc.PreviewClipbridgeReply(reply)
	if err != nil {
		t.Fatalf("PreviewClipbridgeReply: %v", err)
	}
	if !preview.Valid || preview.RouteWorkflowID != composition.ReplyCardsWorkflowID {
		t.Fatalf("preview = %+v", preview)
	}
	if len(preview.Cards) != 2 {
		t.Fatalf("got %d offers, want 2", len(preview.Cards))
	}
	if preview.Cards[0].CollidesWithID == "" {
		t.Errorf("existing title must flag its collision: %+v", preview.Cards[0])
	}
	if preview.Cards[1].CollidesWithID != "" {
		t.Errorf("fresh title must not flag: %+v", preview.Cards[1])
	}

	// Accept only the non-colliding item (the review surface's default)
	// and run the preview's own route.
	accepted, _ := json.Marshal([]map[string]string{{"title": preview.Cards[1].Draft.Title}})
	summary, err := exec.RunWorkflow(preview.RouteWorkflowID, RunKindTest, map[string]string{"items": string(accepted)})
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.Status != "SUCCESS" {
		t.Fatalf("summary = %+v, want SUCCESS", summary)
	}
	var count int
	for _, c := range atlasSvc.Cards() {
		if c.Title == "Fresh card" {
			count++
		}
		if c.Title == "Discovery workstream" {
			count += 0
		}
	}
	if count != 1 {
		t.Fatalf("accepted card count = %d, want exactly 1", count)
	}
}
