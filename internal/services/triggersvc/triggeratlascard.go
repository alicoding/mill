package triggersvc

import "encoding/json"

// AtlasCardEvent is the JSON payload a trigger-atlas-card fire carries
// as its InitialPayload -- documented on the NodeType's own Output
// description (composition/triggers.go).
type AtlasCardEvent struct {
	CardID     string `json:"cardId"`
	KindID     string `json:"kindId"`
	Title      string `json:"title"`
	ChangeType string `json:"changeType"`
}

// Schema (composition.NodeType{ID: "trigger-atlas-card", ...}) registers
// from internal/domain/composition/triggers.go, not here -- see that
// file's doc comment. This dispatch half needs real *TriggerService
// state (s.atlasCardTriggers), so it can't live in the domain package.
func init() {
	RegisterTrigger("trigger-atlas-card", func(s *TriggerService, workflowID string, config map[string]string) (*activeListener, error) {
		kindID := config["kindId"]
		if kindID == "" {
			return nil, nil
		}
		// Sync (the only caller of start, hence of this closure) already
		// holds s.mu for its entire body -- no separate lock here, same
		// as trigger-system-event's own starter.
		s.atlasCardTriggers[kindID] = append(s.atlasCardTriggers[kindID], workflowID)
		return &activeListener{atlasCardStop: func() {
			bindings := s.atlasCardTriggers[kindID]
			for i, wf := range bindings {
				if wf == workflowID {
					s.atlasCardTriggers[kindID] = append(bindings[:i], bindings[i+1:]...)
					break
				}
			}
		}}, nil
	})
}

// DispatchAtlasCardChange is atlassvc's card-change seam (main.go wires
// atlassvc.SetCardChangeSink to this method once both services exist --
// atlassvc never imports triggersvc, the dependency runs the other way,
// same injected-function shape every other seam in this codebase uses).
// Fires every workflow currently armed for kindID, EXCEPT when the
// cycle guard applies (docs/goals/0066): sourceRunID names the run that
// made this write, if any ("" for a manual Atlas UI edit or an import);
// when that run's OWN recorded source card is THIS card, the write is
// the run reacting to its own trigger event, and re-firing would loop
// it back into itself, so this dispatch is skipped entirely for this
// write (not just for the workflow that started that run -- the
// guard's whole point is "this exact card-write event never re-enters
// trigger-atlas-card at all").
//
//wails:ignore
func (s *TriggerService) DispatchAtlasCardChange(cardID, kindID, title, changeType, sourceRunID string) {
	if sourceRunID != "" && s.exec != nil {
		if srcCard, ok := s.exec.AtlasSourceCardForRun(sourceRunID); ok && srcCard == cardID {
			return
		}
	}

	s.mu.Lock()
	targets := append([]string(nil), s.atlasCardTriggers[kindID]...)
	s.mu.Unlock()
	if len(targets) == 0 {
		return
	}

	ev := AtlasCardEvent{CardID: cardID, KindID: kindID, Title: title, ChangeType: changeType}
	payload, err := json.Marshal(ev)
	if err != nil {
		s.logger.Error("atlas-card: encode payload", "card", cardID, "error", err)
		return
	}
	// A workflow using trigger-atlas-card declares its own Attributes
	// schema (same test-input-form mechanism every other Values-seeded
	// run already uses, docs/adr/0008) -- these four values populate
	// whichever of cardId/kindId/cardTitle/changeType it actually
	// declared, same permissive "a value with no matching declared
	// Attribute is simply unused" behavior every other caller of
	// RunWorkflowWithPayload's values param already relies on.
	values := map[string]string{"cardId": cardID, "kindId": kindID, "cardTitle": title, "changeType": changeType}
	for _, wfID := range targets {
		go s.fireAtlasCard(wfID, cardID, string(payload), values)
	}
}

// fireAtlasCard starts wfID as a trigger-atlas-card fire, recording
// cardID as the run's own AtlasSourceCardID for the cycle guard above.
func (s *TriggerService) fireAtlasCard(workflowID, cardID, payload string, values map[string]string) {
	summary, err := s.exec.RunWorkflowForAtlasCard(workflowID, cardID, values, payload)
	s.reportFireOutcome(workflowID, "", summary, err)
}
