package remoteauthsvc

import (
	"bufio"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/domain/notification"
)

// TestMintDevice_TopicsAreUniqueAndFullLength pins SLICE B item 1:
// "long, ~32 chars, unguessable" -- 20 mints must never collide and
// must always be the full hex-encoded length.
func TestMintDevice_TopicsAreUniqueAndFullLength(t *testing.T) {
	s := newTestService(t)
	seen := make(map[string]bool)
	for i := 0; i < 20; i++ {
		if _, err := s.mintDevice("Device", "", KindDevice); err != nil {
			t.Fatalf("mintDevice() = %v, want nil error", err)
		}
	}
	if len(s.devices) != 20 {
		t.Fatalf("devices = %d, want 20", len(s.devices))
	}
	for _, d := range s.devices {
		if len(d.Topic) != deviceTopicBytes*2 {
			t.Fatalf("topic %q length = %d, want %d", d.Topic, len(d.Topic), deviceTopicBytes*2)
		}
		if seen[d.Topic] {
			t.Fatalf("duplicate topic generated: %q", d.Topic)
		}
		seen[d.Topic] = true
	}
}

// TestLoadDevices_BackfillsTopicForPreExistingDevice pins the upgrade
// path: a device persisted before the phone channel existed (no
// "topic" field at all) gets one assigned on load, and that backfill
// itself persists rather than re-rolling on every restart.
func TestLoadDevices_BackfillsTopicForPreExistingDevice(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	store, err := settings.New(path)
	if err != nil {
		t.Fatalf("settings.New() = %v, want nil error", err)
	}
	raw := `[{"id":"dev-1","label":"Old Phone","salt":"aa","hash":"bb","createdAt":"2026-01-01T00:00:00Z","lastSeenAt":"2026-01-01T00:00:00Z"}]`
	if err := store.Set(devicesSettingsKey, raw); err != nil {
		t.Fatalf("store.Set() = %v, want nil error", err)
	}

	s := New(store, slog.New(slog.DiscardHandler))
	if len(s.devices) != 1 || s.devices[0].Topic == "" {
		t.Fatalf("devices = %+v, want a backfilled topic", s.devices)
	}
	backfilled := s.devices[0].Topic

	store2, err := settings.New(path)
	if err != nil {
		t.Fatalf("second settings.New() = %v, want nil error", err)
	}
	s2 := New(store2, slog.New(slog.DiscardHandler))
	if len(s2.devices) != 1 || s2.devices[0].Topic != backfilled {
		t.Fatalf("backfilled topic did not persist across restart: %+v", s2.devices)
	}
}

// TestNtfySubscribe_UnknownTopicGets404 pins SLICE B item 2: a
// well-formed but never-minted topic gets a plain 404, on both a
// loopback and non-loopback connection -- the ntfy path bypasses the
// pairing gate entirely rather than falling through to it.
func TestNtfySubscribe_UnknownTopicGets404(t *testing.T) {
	s := newTestService(t)
	handler := s.Middleware()(appHandler())

	for _, remoteAddr := range []string{"127.0.0.1:1", "203.0.113.50:1"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/"+strings.Repeat("a", 32)+"/json", nil)
		req.RemoteAddr = remoteAddr
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s: status = %d, want 404", remoteAddr, rec.Code)
		}
	}
}

// TestNtfySubscribe_RevokedTopicGets404 pins "revoking a device MUST
// kill its topic": a future request for a since-revoked topic gets the
// same 404 as a topic that never existed.
func TestNtfySubscribe_RevokedTopicGets404(t *testing.T) {
	s := newTestService(t)
	if _, err := s.mintDevice("Phone", "", KindDevice); err != nil {
		t.Fatalf("mintDevice() = %v, want nil error", err)
	}
	id, topic := s.devices[0].ID, s.devices[0].Topic
	if err := s.RevokeDevice(id); err != nil {
		t.Fatalf("RevokeDevice() = %v, want nil error", err)
	}

	handler := s.Middleware()(appHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/"+topic+"/json", nil)
	req.RemoteAddr = "203.0.113.51:1"
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 for a revoked topic", rec.Code)
	}
}

// streamLines opens a real GET to url via a real network round trip
// (never httptest.ResponseRecorder, which isn't safe to read from a
// second goroutine while the handler is still writing) and returns a
// channel of NDJSON lines plus the response for the caller to close.
func streamLines(t *testing.T, url string) (*http.Response, <-chan string) {
	t.Helper()
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("building request for %s = %v, want nil error", url, err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET %s = %v, want nil error", url, err)
	}
	if resp.StatusCode != http.StatusOK {
		_ = resp.Body.Close()
		t.Fatalf("GET %s: status = %d, want 200", url, resp.StatusCode)
	}
	lines := make(chan string, 8)
	go func() {
		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			lines <- scanner.Text()
		}
		close(lines)
	}()
	return resp, lines
}

func nextLine(t *testing.T, lines <-chan string) string {
	t.Helper()
	select {
	case line, ok := <-lines:
		if !ok {
			t.Fatal("stream closed before the expected line arrived")
		}
		return line
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for a stream line")
		return ""
	}
}

// TestPhoneChannel_StreamEmitsPublishedRecord is the SLICE B DESIGN
// CONTRACT's headline proof: a real subscribe connection gets an
// "open" line on connect, then the phone channel's own Deliver call
// (as the 0171 registry would invoke it) reaches that SAME connection
// with the event's title/body and a click URL landing on Review. The
// device was minted with no known base address -- subscribing itself
// is what teaches Mill the device's real reachable address
// (recordTopicSeen), the same self-refresh a real ntfy client's
// reconnect loop keeps current in production.
func TestPhoneChannel_StreamEmitsPublishedRecord(t *testing.T) {
	s := newTestService(t)
	if _, err := s.mintDevice("Phone", "", KindDevice); err != nil {
		t.Fatalf("mintDevice() = %v, want nil error", err)
	}
	topic := s.devices[0].Topic

	server := httptest.NewServer(s.Middleware()(appHandler()))
	defer server.Close()

	resp, lines := streamLines(t, server.URL+"/"+topic+"/json")
	defer func() { _ = resp.Body.Close() }()

	if open := nextLine(t, lines); !strings.Contains(open, `"event":"open"`) {
		t.Fatalf("first line = %q, want the ntfy open event", open)
	}

	ch := s.NotificationChannel()
	rec := notification.Record{ID: "rec-1", CreatedAt: time.Now()}
	evt := notification.Event{Type: "mcp-write", Title: "Approval needed", Body: "Workflow X needs your review"}
	if err := ch.Deliver(evt, rec); err != nil {
		t.Fatalf("Deliver() = %v, want nil error", err)
	}

	msg := nextLine(t, lines)
	if !strings.Contains(msg, `"message":"Workflow X needs your review"`) {
		t.Errorf("delivered line = %q, want the event body as message", msg)
	}
	if !strings.Contains(msg, `"title":"Approval needed"`) {
		t.Errorf("delivered line = %q, want the event title", msg)
	}
	wantClick := `"click":"` + server.URL + `/#/review"`
	if !strings.Contains(msg, wantClick) {
		t.Errorf("delivered line = %q, want %s", msg, wantClick)
	}
}

// TestPhoneChannel_DeliverOmitsClickWithNoKnownBaseAddress: a device
// Mill has never seen a resolvable host from yet must not emit a
// dangling/incomplete click URL. Subscribed directly (addSubscriber)
// rather than over real HTTP -- a live subscribe connection is exactly
// what teaches Mill the device's base address, so the only way to
// observe a still-unknown one is to never make that connection at all.
func TestPhoneChannel_DeliverOmitsClickWithNoKnownBaseAddress(t *testing.T) {
	s := newTestService(t)
	if _, err := s.mintDevice("Phone", "", KindDevice); err != nil {
		t.Fatalf("mintDevice() = %v, want nil error", err)
	}
	topic := s.devices[0].Topic

	_, cancel := context.WithCancel(context.Background())
	defer cancel()
	sub := ntfySubscriber{ch: make(chan ntfyMessage, 1), cancel: cancel}
	s.addSubscriber(topic, sub)
	defer s.removeSubscriber(topic, sub)

	ch := s.NotificationChannel()
	if err := ch.Deliver(notification.Event{Title: "Approval needed", Body: "x"}, notification.Record{ID: "rec-2", CreatedAt: time.Now()}); err != nil {
		t.Fatalf("Deliver() = %v, want nil error", err)
	}

	select {
	case msg := <-sub.ch:
		if msg.Click != "" {
			t.Errorf("Click = %q, want empty with an unknown base address", msg.Click)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for the delivered message")
	}
}

// TestPhoneChannel_RevokeClosesAnOpenStream pins "revoking a device
// MUST kill its topic" for a connection that is ALREADY open, not just
// future requests -- the stream must end immediately, not merely
// reject the next reconnect.
func TestPhoneChannel_RevokeClosesAnOpenStream(t *testing.T) {
	s := newTestService(t)
	if _, err := s.mintDevice("Phone", "", KindDevice); err != nil {
		t.Fatalf("mintDevice() = %v, want nil error", err)
	}
	id, topic := s.devices[0].ID, s.devices[0].Topic

	server := httptest.NewServer(s.Middleware()(appHandler()))
	defer server.Close()

	resp, lines := streamLines(t, server.URL+"/"+topic+"/json")
	defer func() { _ = resp.Body.Close() }()
	nextLine(t, lines) // the open event

	done := make(chan struct{})
	go func() {
		_, _ = io.Copy(io.Discard, resp.Body)
		close(done)
	}()

	if err := s.RevokeDevice(id); err != nil {
		t.Fatalf("RevokeDevice() = %v, want nil error", err)
	}

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("stream did not close after its device was revoked")
	}
}

// TestPhoneChannel_ShouldDeliver pins SLICE B item 5: true exactly
// when at least one paired device carries a topic, never consulting
// evt.Focused.
func TestPhoneChannel_ShouldDeliver(t *testing.T) {
	s := newTestService(t)
	ch := s.NotificationChannel()

	if ch.ShouldDeliver(notification.Event{Focused: true}) {
		t.Fatalf("ShouldDeliver() = true with no paired devices, want false")
	}
	if _, err := s.mintDevice("Phone", "", KindDevice); err != nil {
		t.Fatalf("mintDevice() = %v, want nil error", err)
	}
	if !ch.ShouldDeliver(notification.Event{Focused: true}) {
		t.Fatalf("ShouldDeliver() = false with a paired device (Focused=true), want true -- a phone's delivery must never depend on a browser tab's focus")
	}
}
