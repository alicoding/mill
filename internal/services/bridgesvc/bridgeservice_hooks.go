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

// HookEventPath is the hook door: the one route an external tool's
// hook (an agent's hook config, a CI script) POSTs to in order to fire
// trigger-webhook workflows. It lives on the bridge mux because the
// bridge is already Mill's loopback HTTP listener for outside-tool
// intake; a webhook event is intake of exactly that shape. The door
// requires its bearer credential even over loopback -- the same design
// rule the Handler doc comment states for the browser routes.
const HookEventPath = "/__mill/hooks/event"

// webhookEventSink is what a validated hook post becomes: a trigger
// dispatch, never a direct notification (the door fires a trigger; the
// workflow it arms decides what happens next). values is the posted
// object's scalar top-level fields stringified; raw is the body
// exactly as posted.
type webhookEventSink func(values map[string]string, raw []byte)

// SetWebhookEventSink wires the dispatch seam the hook route calls
// after a request passes its token and shape checks. A late-bound
// setter, not a constructor parameter: bridgesvc never imports
// triggersvc (the dependency runs the other way), and main.go
// assembles both.
//
//wails:ignore
func (s *BridgeService) SetWebhookEventSink(sink webhookEventSink) {
	s.hookMu.Lock()
	s.hookSink = sink
	s.hookMu.Unlock()
}

// handleHookEvent is the hook door's handler. The posted body is any
// JSON object: its top-level scalar fields become a workflow run's
// Attribute values by name, and the raw body is the run's payload.
func (s *BridgeService) handleHookEvent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	device, ok := s.auth.ValidateHookToken(bearerToken(r))
	if !ok {
		s.recordCommand(r.Context(), "hook-event", audit.Target{}, "hook:"+sourceKey(r), "rejected", "unauthorized", http.StatusUnauthorized, "")
		writeUserError(w, http.StatusUnauthorized, usererror.New("bad-hook-token", "That hook token didn't work. Mint a new one in Settings and try again."))
		return
	}
	actorSource := "hook:" + device.ID

	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxResultBytes))
	if err != nil {
		s.recordCommand(r.Context(), "hook-event", audit.Target{}, actorSource, "rejected", "", http.StatusBadRequest, "")
		writeUserError(w, http.StatusBadRequest, usererror.New("bad-hook-event", "That hook event wasn't readable. Post a JSON object."))
		return
	}
	var fields map[string]any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&fields); err != nil {
		s.recordCommand(r.Context(), "hook-event", audit.Target{}, actorSource, "rejected", "", http.StatusBadRequest, "")
		writeUserError(w, http.StatusBadRequest, usererror.New("bad-hook-event", "That hook event wasn't readable. Post a JSON object."))
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

	s.hookMu.Lock()
	sink := s.hookSink
	s.hookMu.Unlock()
	if sink == nil {
		// Unreachable in a wired app -- main.go sets the sink at
		// startup -- so this reads as the wiring fault it is rather
		// than as a client error.
		s.recordCommand(r.Context(), "hook-event", audit.Target{}, actorSource, "error", "", http.StatusInternalServerError, "")
		writeUserError(w, http.StatusInternalServerError, usererror.New("hook-not-wired", "The hook door isn't wired up. Restart Mill and try again."))
		return
	}

	target := audit.Target{}
	if source, ok := values["source"]; ok {
		target = audit.Target{Kind: "trigger-source", ID: source, Label: source}
	}
	s.recordCommand(r.Context(), "hook-event", target, actorSource, "accepted", "", http.StatusAccepted, "")
	sink(values, raw)
	w.WriteHeader(http.StatusAccepted)
}
