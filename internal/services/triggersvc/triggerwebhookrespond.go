package triggersvc

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/executionsvc"
)

// WebhookReply is what a respond-webhook step delivers back through
// DispatchWebhookEvent's own WebhookWait (goal 0373) -- Status 0 marks
// "no started run answered," letting the ingress answer with the
// standard body PROMPTLY once every run that could still answer is
// known to be done, rather than only once the budget elapses.
type WebhookReply struct {
	Status      int
	ContentType string
	Body        string
}

// WebhookWait is what DispatchWebhookEvent hands back when at least one
// started listener's graph contains a respond-webhook node -- the
// caller selects on Reply up to Budget, the MAX respondWithinSeconds
// among exactly those listeners.
type WebhookWait struct {
	Reply  <-chan WebhookReply
	Budget time.Duration
}

// dispatchRespondingTargets starts every responder-eligible target,
// each carrying its own run-scoped runResponder, and returns the
// cross-run WebhookWait the ingress selects on: the first run to reply
// wins (first-wins across runs, goal 0373 design contract item 3); once
// every target that is NOT currently parked has finished without
// replying, a Status-0 sentinel answers the wait promptly instead of
// only at the budget (item 3's "terminal-without-reply" case).
func (s *TriggerService) dispatchRespondingTargets(targets []webhookBinding, payload string, values map[string]string) *WebhookWait {
	budget := time.Duration(0)
	for _, b := range targets {
		if d := time.Duration(b.respondWithinSeconds) * time.Second; d > budget {
			budget = d
		}
	}

	outcome := make(chan WebhookReply, 1)
	outstanding := int32(len(targets)) //nolint:gosec // G115: bounded by armed listener count, never near int32's range
	for _, b := range targets {
		s.goFire(func() { s.fireRespondingTarget(b.workflowID, payload, values, outcome, &outstanding) })
	}
	return &WebhookWait{Reply: outcome, Budget: budget}
}

// fireRespondingTarget runs one responder-eligible target: its
// run-scoped runResponder forwards the FIRST Reply call within that run
// to outcome, best-effort (a losing run's own reply still lands on its
// own Record, it simply doesn't win the caller's one HTTP response).
// When this run finishes in a genuinely terminal state (never parked)
// without ever replying, decrementing outstanding to zero answers
// outcome with the "nobody replied" sentinel immediately.
func (s *TriggerService) fireRespondingTarget(workflowID, payload string, values map[string]string, outcome chan<- WebhookReply, outstanding *int32) {
	responder := newRunResponder(outcome)
	summary, err := s.exec.RunWorkflowWithResponder(workflowID, executionsvc.RunKindTriggered, values, payload, responder)
	s.reportFireOutcome(workflowID, "", summary, err)
	// A run still in flight -- genuinely running, or freshly parked
	// (docs/adr/0022) -- stays outstanding: goal 0373 design contract
	// item 5 keeps the caller waiting on it until the budget, never
	// treats it as "terminal, nobody will ever answer." Checked via
	// RunSummary.StillRunning, never a bare nil-Pending read (that
	// alone can race a park that hasn't landed yet).
	if summary.StillRunning() {
		return
	}
	if atomic.AddInt32(outstanding, -1) == 0 {
		select {
		case outcome <- WebhookReply{Status: 0}:
		default:
		}
	}
}

// runResponder is the run-scoped composition.WebhookResponder a
// webhook-started run carries in its ExecContext when its graph
// contains a respond-webhook node. The FIRST Reply call within THIS
// run wins (n8n's own "a second Respond node is ignored" semantics);
// every later call in the same run learns who already answered instead
// of silently double-replying.
type runResponder struct {
	mu      sync.Mutex
	replied bool
	stepID  string
	outcome chan<- WebhookReply
}

func newRunResponder(outcome chan<- WebhookReply) *runResponder {
	return &runResponder{outcome: outcome}
}

func (r *runResponder) Reply(stepID string, status int, contentType, body string) (bool, string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.replied {
		return false, r.stepID
	}
	r.replied = true
	r.stepID = stepID
	select {
	case r.outcome <- WebhookReply{Status: status, ContentType: contentType, Body: body}:
	default:
		// Another run's reply, or the "nobody will ever answer"
		// sentinel, already claimed the caller's one HTTP response --
		// this run's own reply still counts as delivered from ITS OWN
		// perspective (recorded on its own Record); it simply didn't
		// win the cross-run race.
	}
	return true, stepID
}

var _ composition.WebhookResponder = (*runResponder)(nil)
