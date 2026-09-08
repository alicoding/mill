package triggersvc

import (
	"strconv"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/executionsvc"
)

// defaultRespondBudgetSeconds/minRespondBudgetSeconds/
// maxRespondBudgetSeconds mirror trigger-webhook's own
// respondWithinSeconds ConfigField default/bounds (composition/
// triggers.go) -- enforced here since typedfield.Field has no min/max
// facet of its own (goal 0373).
const (
	defaultRespondBudgetSeconds = 55
	minRespondBudgetSeconds     = 1
	maxRespondBudgetSeconds     = 590
)

// webhookBinding is one armed trigger-webhook listener -- workflowID
// plus the facts Sync already knows about its own armed graph (goal
// 0373), computed once at Sync/start time rather than re-resolved on
// every dispatch.
type webhookBinding struct {
	workflowID string
	// respondWithinSeconds is this listener's own budget. Only
	// meaningful when hasResponder is true.
	respondWithinSeconds int
	// hasResponder is true when this listener's armed graph contains a
	// respond-webhook node -- DispatchWebhookEvent uses it to decide
	// whether the ingress waits at all.
	hasResponder bool
}

// parseRespondBudgetSeconds reads trigger-webhook's respondWithinSeconds
// config, clamped to [minRespondBudgetSeconds, maxRespondBudgetSeconds]
// -- an empty, non-numeric, or out-of-range value falls back to the
// default rather than arming a listener with no bound at all or one a
// typo shrank to zero.
func parseRespondBudgetSeconds(raw string) int {
	n, err := strconv.Atoi(raw)
	if err != nil {
		return defaultRespondBudgetSeconds
	}
	switch {
	case n < minRespondBudgetSeconds:
		return minRespondBudgetSeconds
	case n > maxRespondBudgetSeconds:
		return maxRespondBudgetSeconds
	default:
		return n
	}
}

// graphHasRespondWebhook reports whether nodes contains a respond-webhook
// step -- the graph-level fact that decides whether the workflow this
// trigger-webhook listener arms can ever answer its own caller.
func graphHasRespondWebhook(nodes []composition.Node) bool {
	for _, n := range nodes {
		if n.NodeTypeID == composition.RespondWebhookNodeTypeID {
			return true
		}
	}
	return false
}

// Schema (composition.NodeType{ID: "trigger-webhook", ...}) registers
// from internal/domain/composition/triggers.go, not here -- see that
// file's doc comment. This dispatch half needs real *TriggerService
// state (s.webhookTriggers), so it can't live in the domain package.
func init() {
	RegisterTrigger("trigger-webhook", func(s *TriggerService, workflowID string, nodes []composition.Node, config map[string]string) (*activeListener, error) {
		// An empty source arms for EVERY webhook event, including one
		// carrying no source field at all; a configured source is an
		// exact match (lower-cased by the ingress), never a wildcard --
		// same match shape trigger-system-event's own registry uses.
		source := config["source"]
		binding := webhookBinding{
			workflowID:           workflowID,
			respondWithinSeconds: parseRespondBudgetSeconds(config["respondWithinSeconds"]),
			hasResponder:         graphHasRespondWebhook(nodes),
		}
		// Sync (the only caller of start, hence of this closure) already
		// holds s.mu for its entire body -- no separate lock here, same
		// as trigger-system-event's own starter.
		s.webhookTriggers[source] = append(s.webhookTriggers[source], binding)
		return &activeListener{webhookStop: func() {
			bindings := s.webhookTriggers[source]
			for i, b := range bindings {
				if b.workflowID == workflowID {
					s.webhookTriggers[source] = append(bindings[:i], bindings[i+1:]...)
					break
				}
			}
		}}, nil
	})
}

// DispatchWebhookEvent is the webhook door's dispatch seam (the
// bridge's webhook route is wired to it from main.go, adapted to
// bridgesvc's own WebhookWait/WebhookReply shape there -- bridgesvc
// never imports this package, the dependency runs the other way, same
// injected-function shape every other seam in this codebase uses).
// values is the posted JSON object's scalar top-level fields,
// stringified; raw is the body exactly as posted. Fires every workflow
// currently armed for an exact source match PLUS every catch-all
// (source == "") arming; a values map without a source fires the
// catch-alls only.
//
// Returns nil when no started listener's graph contains a
// respond-webhook node -- the caller ACKs immediately, byte-identical
// to before this goal (goal 0373 design contract item 3). Otherwise
// returns a WebhookWait the caller waits on, up to the MAX budget among
// the listeners that can actually answer.
//
//wails:ignore
func (s *TriggerService) DispatchWebhookEvent(values map[string]string, raw []byte) *WebhookWait {
	source := values["source"]
	s.mu.Lock()
	targets := append([]webhookBinding(nil), s.webhookTriggers[source]...)
	if source != "" {
		targets = append(targets, s.webhookTriggers[""]...)
	}
	s.mu.Unlock()
	if len(targets) == 0 {
		return nil
	}

	payload := string(raw)
	var responderTargets []webhookBinding
	for _, b := range targets {
		if b.hasResponder {
			responderTargets = append(responderTargets, b)
			continue
		}
		go s.fireWebhookEvent(b.workflowID, payload, values)
	}
	if len(responderTargets) == 0 {
		return nil
	}
	return s.dispatchRespondingTargets(responderTargets, payload, values)
}

// fireWebhookEvent starts wfID as a trigger-webhook fire through the
// same single execution path every trigger fire uses (ADR-0008),
// passing the posted fields through as run values -- unlike s.fire,
// which always passes nil values.
func (s *TriggerService) fireWebhookEvent(workflowID, payload string, values map[string]string) {
	summary, err := s.exec.RunWorkflowWithPayload(workflowID, executionsvc.RunKindTriggered, values, payload)
	s.reportFireOutcome(workflowID, "", summary, err)
}
