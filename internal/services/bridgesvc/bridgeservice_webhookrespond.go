package bridgesvc

import (
	"net/http"
	"time"
)

// WebhookReply is one respond-webhook step's answer, as the webhook
// route writes it back to the caller verbatim -- Status/ContentType/
// Body are the workflow's own composition, never a Mill-chosen shape.
type WebhookReply struct {
	Status      int
	ContentType string
	Body        string
}

// WebhookWait is what a webhookEventSink hands back when at least one
// started run's graph can still answer this caller: Reply delivers the
// FIRST reply across every such run (goal 0373's first-wins rule) --
// including a zero-Status sentinel once every run that could still
// answer is known to be done and none did, so the fallback fires
// PROMPTLY rather than only once Budget elapses.
type WebhookWait struct {
	Reply  <-chan WebhookReply
	Budget time.Duration
}

// webhookStandardReplyBody is what the door answers with whenever no
// run actually replied -- a run without a respond-webhook step never
// blocks its caller at all (webhookEventSink returns nil, handled
// separately); this is only the "had a chance to answer and didn't"
// body, matching n8n's own Respond-to-Webhook precedent (a static 200,
// never a 4xx, so the fallback never reads as a guardrail's own deny).
const webhookStandardReplyBody = `{"reply":"none"}`

// answerWebhook writes wait's outcome to w -- nil (no started run's
// graph contains a respond-webhook node) ACKs exactly as before this
// goal existed, byte-identical (202, empty body). Otherwise it waits up
// to wait.Budget for the first reply, writing the standard body with a
// Mill-Reply: none header only when the budget itself is what ran out
// (a run finishing without ever answering gets the same standard body,
// but promptly, with no header -- the caller can tell "nothing
// answered in time" apart from "nothing was ever going to").
func (s *BridgeService) answerWebhook(w http.ResponseWriter, wait *WebhookWait) {
	if wait == nil {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	select {
	case reply := <-wait.Reply:
		if reply.Status == 0 {
			writeStandardWebhookReply(w)
			return
		}
		writeWebhookReply(w, reply)
	case <-time.After(wait.Budget):
		w.Header().Set("Mill-Reply", "none")
		writeStandardWebhookReply(w)
	}
}

func writeWebhookReply(w http.ResponseWriter, reply WebhookReply) {
	if reply.ContentType != "" {
		w.Header().Set("Content-Type", reply.ContentType)
	}
	status := reply.Status
	if status == 0 {
		status = http.StatusOK
	}
	w.WriteHeader(status)
	if reply.Body != "" {
		_, _ = w.Write([]byte(reply.Body))
	}
}

func writeStandardWebhookReply(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(webhookStandardReplyBody))
}
