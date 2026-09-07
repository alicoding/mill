package triggersvc

import (
	"github.com/alicoding/mill/internal/services/executionsvc"
)

// Schema (composition.NodeType{ID: "trigger-webhook", ...}) registers
// from internal/domain/composition/triggers.go, not here -- see that
// file's doc comment. This dispatch half needs real *TriggerService
// state (s.webhookTriggers), so it can't live in the domain package.
func init() {
	RegisterTrigger("trigger-webhook", func(s *TriggerService, workflowID string, config map[string]string) (*activeListener, error) {
		// An empty source arms for EVERY webhook event, including one
		// carrying no source field at all; a configured source is an
		// exact match (lower-cased by the ingress), never a wildcard --
		// same match shape trigger-system-event's own registry uses.
		source := config["source"]
		// Sync (the only caller of start, hence of this closure) already
		// holds s.mu for its entire body -- no separate lock here, same
		// as trigger-system-event's own starter.
		s.webhookTriggers[source] = append(s.webhookTriggers[source], workflowID)
		return &activeListener{webhookStop: func() {
			bindings := s.webhookTriggers[source]
			for i, wf := range bindings {
				if wf == workflowID {
					s.webhookTriggers[source] = append(bindings[:i], bindings[i+1:]...)
					break
				}
			}
		}}, nil
	})
}

// DispatchWebhookEvent is the hook door's dispatch seam (the bridge's
// hook route is wired to this method from main.go via
// BridgeService.SetWebhookEventSink -- bridgesvc never imports this
// package, the dependency runs the other way, same injected-function
// shape every other seam in this codebase uses). values is the posted
// JSON object's scalar top-level fields, stringified; raw is the body
// exactly as posted. Fires every workflow currently armed for an exact
// source match PLUS every catch-all (source == "") arming; a values
// map without a source fires the catch-alls only. Each fire runs async
// for the same reason DispatchSystemEvent's own comment gives.
//
//wails:ignore
func (s *TriggerService) DispatchWebhookEvent(values map[string]string, raw []byte) {
	source := values["source"]
	s.mu.Lock()
	targets := append([]string(nil), s.webhookTriggers[source]...)
	if source != "" {
		targets = append(targets, s.webhookTriggers[""]...)
	}
	s.mu.Unlock()
	if len(targets) == 0 {
		return
	}

	// The fired values populate whichever declared Attributes share a
	// name with a posted field -- same permissive unused-value behavior
	// trigger-atlas-card's dispatch already relies on
	// (triggeratlascard.go).
	payload := string(raw)
	for _, wfID := range targets {
		go s.fireWebhookEvent(wfID, payload, values)
	}
}

// fireWebhookEvent starts wfID as a trigger-webhook fire through the
// same single execution path every trigger fire uses (ADR-0008),
// passing the posted fields through as run values -- unlike s.fire,
// which always passes nil values.
func (s *TriggerService) fireWebhookEvent(workflowID, payload string, values map[string]string) {
	summary, err := s.exec.RunWorkflowWithPayload(workflowID, executionsvc.RunKindTriggered, values, payload)
	s.reportFireOutcome(workflowID, "", summary, err)
}
