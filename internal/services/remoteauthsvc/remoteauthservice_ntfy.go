package remoteauthsvc

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"regexp"
	"time"

	"github.com/alicoding/mill/internal/domain/notification"
	"github.com/google/uuid"
)

// The phone channel (docs/goals/0132-remote-access.md SLICE B): Mill
// serves the ntfy subscribe wire protocol directly, so a stock ntfy
// Android client needs no Mill-specific software, only a server
// address and a topic. See "SLICE B DESIGN CONTRACT" in that goal file
// for the full behavior the rest of this file implements.

// deviceTopicBytes is SLICE B item 1's "long, ~32 chars, unguessable"
// topic verbatim -- 16 random bytes hex-encoded to 32 characters, the
// same hex-of-random-bytes shape deviceTokenBytes/deviceSaltBytes
// already use.
const deviceTopicBytes = 16

// ntfyTopicPattern is the ONLY path this package answers outside the
// pairing gate: a bare 32-character lowercase-hex topic followed by
// /json, matching the ntfy subscribe protocol's own <base>/<topic>/json
// shape exactly, so a stock client needs no Mill-specific path. A
// topic this shape can never collide with a real app route.
var ntfyTopicPattern = regexp.MustCompile(`^/([0-9a-f]{32})/json$`)

// ntfyTopicFromPath reports the topic a GET request names, if its path
// matches the subscribe shape -- checked before any other routing, so
// this is the one path in the whole AssetServer that bypasses the
// pairing gate entirely (SLICE B item 2: the ntfy client sends no
// device cookie, so the topic itself has to be the credential).
func ntfyTopicFromPath(r *http.Request) (string, bool) {
	if r.Method != http.MethodGet {
		return "", false
	}
	m := ntfyTopicPattern.FindStringSubmatch(r.URL.Path)
	if m == nil {
		return "", false
	}
	return m[1], true
}

// ntfyMessage is one line of the ntfy wire protocol's newline-
// delimited JSON stream. Message/Click are the only fields Deliver
// ever populates with real content (SLICE B item 3: never the
// payload, only what's waiting and where to look).
type ntfyMessage struct {
	ID      string `json:"id"`
	Time    int64  `json:"time"`
	Event   string `json:"event"`
	Topic   string `json:"topic"`
	Title   string `json:"title,omitempty"`
	Message string `json:"message,omitempty"`
	Click   string `json:"click,omitempty"`
}

// ntfySubscriber is one live subscribe connection: ch is where a
// broadcast lands, cancel forcibly ends that connection's request
// context (RevokeDevice's forceCloseTopic) without ever closing ch
// itself -- closing a channel that broadcastToTopic might concurrently
// be sending to would be a send-on-closed-channel panic; cancelling a
// context instead is always safe to do concurrently.
type ntfySubscriber struct {
	ch     chan ntfyMessage
	cancel context.CancelFunc
}

// handleNtfySubscribe serves GET /<topic>/json: an unknown or revoked
// topic gets a plain 404 (SLICE B item 2 -- no hint the topic form was
// close), a live one gets an ntfy "open" line, then blocks streaming
// further lines until the client disconnects or RevokeDevice force-
// closes it. poll=1 (the protocol's one-shot mode) returns right after
// the open line -- Mill keeps no per-topic backlog to replay.
func (s *RemoteAuthService) handleNtfySubscribe(w http.ResponseWriter, r *http.Request, topic string) {
	if !s.recordTopicSeen(topic, baseURLFor(r)) {
		http.NotFound(w, r)
		return
	}

	flusher, canFlush := w.(http.Flusher)
	if !canFlush {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.WriteHeader(http.StatusOK)
	writeNtfyLine(w, ntfyMessage{ID: uuid.NewString(), Time: time.Now().Unix(), Event: "open", Topic: topic})
	flusher.Flush()

	if r.URL.Query().Get("poll") == "1" {
		return
	}

	ctx, cancel := context.WithCancel(r.Context())
	sub := ntfySubscriber{ch: make(chan ntfyMessage, 8), cancel: cancel}
	s.addSubscriber(topic, sub)
	defer s.removeSubscriber(topic, sub)

	for {
		select {
		case <-ctx.Done():
			return
		case msg := <-sub.ch:
			writeNtfyLine(w, msg)
			flusher.Flush()
		}
	}
}

// recordTopicSeen reports whether topic matches a live paired device,
// updating that device's LastSeenAt/BaseURL on success -- the same
// constant-time-compare-every-entry discipline validateToken uses, so
// an unknown topic costs the same lookup as a real one (item 2's "no
// hint the topic form was close" applies to timing too, not just the
// response body).
func (s *RemoteAuthService) recordTopicSeen(topic, baseURL string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	matchedIndex := -1
	for i, d := range s.devices {
		if d.Topic == "" || len(d.Topic) != len(topic) {
			continue
		}
		if subtle.ConstantTimeCompare([]byte(d.Topic), []byte(topic)) == 1 {
			matchedIndex = i
		}
	}
	if matchedIndex == -1 {
		return false
	}
	s.devices[matchedIndex].LastSeenAt = time.Now()
	if baseURL != "" {
		s.devices[matchedIndex].BaseURL = baseURL
	}
	if err := s.saveDevices(); err != nil {
		s.logger.Error("remote access: recording phone-channel activity", "error", err)
	}
	return true
}

func writeNtfyLine(w http.ResponseWriter, msg ntfyMessage) {
	line, err := json.Marshal(msg)
	if err != nil {
		return
	}
	_, _ = w.Write(line)
	_, _ = w.Write([]byte("\n"))
}

// addSubscriber/removeSubscriber/broadcastToTopic/forceCloseTopic
// share streamMu, never mu -- a subscriber can live for the duration
// of an open HTTP connection, which must never hold the same lock
// every pairing/device operation needs.

func (s *RemoteAuthService) addSubscriber(topic string, sub ntfySubscriber) {
	s.streamMu.Lock()
	defer s.streamMu.Unlock()
	s.streams[topic] = append(s.streams[topic], sub)
}

func (s *RemoteAuthService) removeSubscriber(topic string, sub ntfySubscriber) {
	s.streamMu.Lock()
	defer s.streamMu.Unlock()
	subs := s.streams[topic]
	for i, existing := range subs {
		if existing.ch == sub.ch {
			s.streams[topic] = append(subs[:i], subs[i+1:]...)
			break
		}
	}
	if len(s.streams[topic]) == 0 {
		delete(s.streams, topic)
	}
}

// broadcastToTopic pushes msg to every currently-open subscribe
// connection for topic, non-blocking -- a full subscriber buffer just
// drops this line for that one slow connection rather than stalling
// every other subscriber, or the Publish call that triggered this.
func (s *RemoteAuthService) broadcastToTopic(topic string, msg ntfyMessage) {
	s.streamMu.Lock()
	subs := append([]ntfySubscriber(nil), s.streams[topic]...)
	s.streamMu.Unlock()
	for _, sub := range subs {
		select {
		case sub.ch <- msg:
		default:
		}
	}
}

// forceCloseTopic ends every subscribe connection open for topic right
// now (RevokeDevice) -- cancelling each subscriber's own request
// context, never closing its channel (see ntfySubscriber's own doc
// comment for why).
func (s *RemoteAuthService) forceCloseTopic(topic string) {
	s.streamMu.Lock()
	subs := s.streams[topic]
	delete(s.streams, topic)
	s.streamMu.Unlock()
	for _, sub := range subs {
		sub.cancel()
	}
}

// phoneChannel is the docs/goals/0171 registry entry SLICE B item 5
// asks for: Name/ShouldDeliver/Deliver, nothing more. It broadcasts to
// every currently-paired device's topic in one Deliver call, since a
// notification.Channel fires once per Publish rather than once per
// device.
type phoneChannel struct{ s *RemoteAuthService }

func (phoneChannel) Name() string { return "phone" }

// ShouldDeliver is true whenever at least one paired device carries a
// topic -- deliberately NOT consulting evt.Focused: a browser tab's
// focus on one machine says nothing about a phone in a pocket (docs/
// goals/0171's event/delivery layering).
func (c phoneChannel) ShouldDeliver(notification.Event) bool {
	c.s.mu.Lock()
	defer c.s.mu.Unlock()
	for _, d := range c.s.devices {
		if d.Topic != "" {
			return true
		}
	}
	return false
}

// Deliver fans evt out to every paired device's topic. Each device's
// click target is built from ITS OWN last-known reachable address
// (device.BaseURL), so tapping the notification opens Mill at the same
// address that device already uses, landing on the Review view (SLICE
// B item 4) rather than the home screen.
func (c phoneChannel) Deliver(evt notification.Event, rec notification.Record) error {
	type target struct{ topic, base string }

	c.s.mu.Lock()
	targets := make([]target, 0, len(c.s.devices))
	for _, d := range c.s.devices {
		if d.Topic == "" {
			continue
		}
		targets = append(targets, target{topic: d.Topic, base: d.BaseURL})
	}
	c.s.mu.Unlock()

	for _, t := range targets {
		msg := ntfyMessage{
			ID: rec.ID, Time: rec.CreatedAt.Unix(), Event: "message",
			Topic: t.topic, Title: evt.Title, Message: evt.Body,
		}
		if t.base != "" {
			msg.Click = t.base + "/#/review"
		}
		c.s.broadcastToTopic(t.topic, msg)
	}
	return nil
}

// NotificationChannel exposes this service as a docs/goals/0171
// registry entry -- wired once via internal/services/wiring.
// WirePhoneChannel. Exported for that wiring call only, not a frontend
// RPC (notification.Channel isn't JSON-serializable in a way the
// generated bindings could call anyway).
//
//wails:ignore
func (s *RemoteAuthService) NotificationChannel() notification.Channel {
	return phoneChannel{s: s}
}
