package atlassvc

import (
	"fmt"
	"slices"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// cardActionRunnerFn runs an attached action workflow against a card
// -- injected so this package never imports executionsvc (the same
// seam shape composition.SetListLookup uses). Defaults to erroring so
// an action run before main.go wires the runner fails loudly.
var cardActionRunnerFn = func(workflowID, sourceCardID string, values map[string]string, payload string) error {
	return fmt.Errorf("no card-action runner registered (yet) for workflow %q", workflowID)
}

// SetCardActionRunner wires the execution-side runner. Called once
// from main.go.
//
//wails:ignore
func SetCardActionRunner(fn func(workflowID, sourceCardID string, values map[string]string, payload string) error) {
	cardActionRunnerFn = fn
}

// SetCardActions replaces a card's attached actions (goal 0084) --
// deduplicated, empties dropped; order is the page's display order.
func (a *AtlasService) SetCardActions(id string, workflowIDs []string) (atlas.Card, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	idx := a.findCardLocked(id)
	if idx == -1 {
		return atlas.Card{}, fmt.Errorf("no card with id %q", id)
	}
	cleaned := make([]string, 0, len(workflowIDs))
	for _, w := range workflowIDs {
		if w != "" && !slices.Contains(cleaned, w) {
			cleaned = append(cleaned, w)
		}
	}
	a.cards[idx].ActionWorkflowIDs = cleaned
	if err := a.persistLocked(); err != nil {
		return atlas.Card{}, err
	}
	dataevent.Emit("atlas", a.cards[idx].ID)
	return a.cards[idx], nil
}

// RunCardAction fires one of the card's ATTACHED or OFFERED actions --
// membership is validated here so the bound surface can never run an
// arbitrary workflow against a card it was never attached to. Offered
// = the workflow declares this card's recognized Integration as its
// offer target (goal 0126, atlasrecognition.go) -- exactly as
// deliberate an authorization as attaching, just declared on the
// workflow's side. The payload/values convention mirrors
// trigger-atlas-card's fire exactly (cardId/kindId/cardTitle into
// declared Attributes), with changeType "action".
func (a *AtlasService) RunCardAction(cardID, workflowID string) error {
	a.mu.RLock()
	idx := a.findCardLocked(cardID)
	if idx == -1 {
		a.mu.RUnlock()
		return fmt.Errorf("no card with id %q", cardID)
	}
	c := a.cards[idx]
	a.mu.RUnlock()
	if !slices.Contains(c.ActionWorkflowIDs, workflowID) && !a.workflowOfferedForCard(cardID, workflowID) {
		return fmt.Errorf("workflow %q is not an attached or offered action of card %q", workflowID, cardID)
	}
	// The card's own context flows into the run (goal 0126 slice 1):
	// sourceUrl and every typed field value join the attribute seed,
	// so an action like "refresh this page" gets its URL for free
	// instead of fishing it back out with a find step. Field keys ride
	// under field: to keep the reserved names collision-free.
	values := map[string]string{"cardId": c.ID, "kindId": c.KindID, "cardTitle": c.Title, "changeType": "action", "sourceUrl": c.Source}
	for k, v := range c.Fields {
		values["field:"+k] = v
	}
	payload := fmt.Sprintf(`{"cardId":%q,"kindId":%q,"title":%q,"changeType":"action","sourceUrl":%q}`, c.ID, c.KindID, c.Title, c.Source)
	return cardActionRunnerFn(workflowID, c.ID, values, payload)
}
