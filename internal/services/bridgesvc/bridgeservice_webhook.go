package bridgesvc

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/alicoding/mill/internal/domain/audit"
	"github.com/alicoding/mill/internal/domain/usererror"
)

// WebhookPath is the webhook door: the one route any tool or service
// that can send an HTTP request POSTs to in order to fire
// trigger-webhook workflows. It lives on the bridge mux because the
// bridge is already Mill's loopback HTTP listener for outside-tool
// intake; a webhook post is intake of exactly that shape. The door
// requires its bearer credential even over loopback -- the same design
// rule the Handler doc comment states for the browser routes.
const WebhookPath = "/__mill/webhook"

// webhookEventSink is what a validated webhook post becomes: a trigger
// dispatch, never a direct notification (the door fires a trigger; the
// workflow it arms decides what happens next). values is the posted
// object's scalar top-level fields stringified; raw is the body
// exactly as posted. Returns nil when no started run's graph can ever
// answer this caller (today's immediate-ACK case, goal 0373 design
// contract item 3); otherwise a WebhookWait the caller waits on.
type webhookEventSink func(values map[string]string, raw []byte) *WebhookWait

// SetWebhookEventSink wires the dispatch seam the webhook route calls
// after a request passes its token and shape checks. A late-bound
// setter, not a constructor parameter: bridgesvc never imports
// triggersvc (the dependency runs the other way), and main.go
// assembles both.
//
//wails:ignore
func (s *BridgeService) SetWebhookEventSink(sink webhookEventSink) {
	s.webhookMu.Lock()
	s.webhookSink = sink
	s.webhookMu.Unlock()
}

// handleWebhook is the webhook door's handler. The posted body is any
// JSON object: its top-level scalar fields become a workflow run's
// Attribute values by name, and the raw body is the run's payload.
func (s *BridgeService) handleWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	device, ok := s.auth.ValidateWebhookToken(bearerToken(r))
	if !ok {
		s.recordCommand(r.Context(), "webhook", audit.Target{}, "webhook:"+sourceKey(r), "rejected", "unauthorized", http.StatusUnauthorized, "")
		writeUserError(w, http.StatusUnauthorized, usererror.New("bad-webhook-token", "That webhook token didn't work. Mint a new one in Settings and try again."))
		return
	}
	actorSource := "webhook:" + device.ID

	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxResultBytes))
	if err != nil {
		s.recordCommand(r.Context(), "webhook", audit.Target{}, actorSource, "rejected", "", http.StatusBadRequest, "")
		writeUserError(w, http.StatusBadRequest, usererror.New("bad-webhook-body", "That request wasn't readable. Post a JSON object."))
		return
	}
	var fields map[string]any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&fields); err != nil {
		s.recordCommand(r.Context(), "webhook", audit.Target{}, actorSource, "rejected", "", http.StatusBadRequest, "")
		writeUserError(w, http.StatusBadRequest, usererror.New("bad-webhook-body", "That request wasn't readable. Post a JSON object."))
		return
	}

	// Only scalars carry over as attributes: strings as-is, numbers and
	// true/false in their canonical text, everything else (objects,
	// arrays, null) stays in the raw payload only. Source, when a
	// string, is the trigger's exact-match key, so one canonical casing
	// lands before dispatch: "MyTool" and "mytool" arm the same
	// listeners, and the workflow's own source config is documented as
	// lowercase.
	values := make(map[string]string, len(fields))
	for key, value := range fields {
		switch v := value.(type) {
		case string:
			if key == "source" {
				values[key] = strings.ToLower(v)
			} else {
				values[key] = v
			}
		case bool:
			values[key] = strconv.FormatBool(v)
		case json.Number:
			values[key] = v.String()
		}
	}

	s.webhookMu.Lock()
	sink := s.webhookSink
	s.webhookMu.Unlock()
	if sink == nil {
		// Unreachable in a wired app -- main.go sets the sink at
		// startup -- so this reads as the wiring fault it is rather
		// than as a client error.
		s.recordCommand(r.Context(), "webhook", audit.Target{}, actorSource, "error", "", http.StatusInternalServerError, "")
		writeUserError(w, http.StatusInternalServerError, usererror.New("webhook-not-wired", "The webhook door isn't wired up. Restart Mill and try again."))
		return
	}

	target := audit.Target{}
	if source, ok := values["source"]; ok {
		target = audit.Target{Kind: "trigger-source", ID: source, Label: source}
	}
	// "accepted" records the intake succeeding (credential + shape
	// checks passed, dispatched into the trigger layer) -- independent
	// of what a respond-webhook step later replies with, the same way
	// the pre-goal-0373 always-202 response never varied on that either.
	s.recordCommand(r.Context(), "webhook", target, actorSource, "accepted", "", http.StatusAccepted, "")
	s.answerWebhook(w, sink(values, raw))
}
