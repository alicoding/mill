package bridgesvc_test

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/alicoding/mill/internal/services/bridgesvc"
)

// webhookFixture wires the webhook door with a captured sink, the same
// half of main.go's assembly these ingress tests pin. wait, when set,
// is what the sink returns to the next post -- nil (the default)
// matches every listener with no respond-webhook node, byte-identical
// to before goal 0373.
type webhookFixture struct {
	srv *httptest.Server

	mu     sync.Mutex
	values map[string]string
	raw    []byte
	calls  int
	wait   *bridgesvc.WebhookWait
}

func newWebhookFixture(t *testing.T) *webhookFixture {
	t.Helper()
	auth := &stubAuth{token: "good", webhookToken: "webhook-good"}
	fixture := &webhookFixture{}
	svc := bridgesvc.New(auth, slog.New(slog.DiscardHandler))
	svc.SetWebhookEventSink(func(values map[string]string, raw []byte) *bridgesvc.WebhookWait {
		fixture.mu.Lock()
		fixture.values, fixture.raw = values, raw
		fixture.calls++
		wait := fixture.wait
		fixture.mu.Unlock()
		return wait
	})
	srv := httptest.NewServer(svc.Handler())
	t.Cleanup(srv.Close)
	fixture.srv = srv
	return fixture
}

// setWait arms the sink to return wait on the NEXT post.
func (f *webhookFixture) setWait(wait *bridgesvc.WebhookWait) {
	f.mu.Lock()
	f.wait = wait
	f.mu.Unlock()
}

func (f *webhookFixture) post(t *testing.T, token, body string) (int, []byte) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, f.srv.URL+bridgesvc.WebhookPath, strings.NewReader(body))
	if err != nil {
		t.Fatalf("NewRequest() = %v, want nil error", err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST = %v, want nil error", err)
	}
	defer func() { _ = resp.Body.Close() }()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body = %v, want nil error", err)
	}
	return resp.StatusCode, respBody
}

// postFull is post plus the response headers, for a case that needs to
// assert Content-Type or Mill-Reply -- always the same valid, minimal
// post, since every caller is exercising the WAIT/REPLY behavior past
// dispatch, never what gets posted (TestWebhook_RequiresAWebhookToken
// and TestWebhook_ValidPost_DispatchesValuesAndRawBody already own the
// token gate and the values/raw parsing respectively).
func (f *webhookFixture) postFull(t *testing.T) (int, http.Header, []byte) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, f.srv.URL+bridgesvc.WebhookPath, strings.NewReader(`{"source":"ci"}`))
	if err != nil {
		t.Fatalf("NewRequest() = %v, want nil error", err)
	}
	req.Header.Set("Authorization", "Bearer webhook-good")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST = %v, want nil error", err)
	}
	defer func() { _ = resp.Body.Close() }()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body = %v, want nil error", err)
	}
	return resp.StatusCode, resp.Header, respBody
}

func (f *webhookFixture) captured() (map[string]string, []byte, int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.values, f.raw, f.calls
}

func TestWebhook_RequiresAWebhookToken(t *testing.T) {
	fixture := newWebhookFixture(t)

	for _, name := range []string{"no header", "wrong token", "a browser token on the webhook route"} {
		t.Run(name, func(t *testing.T) {
			var token string
			switch name {
			case "no header":
				token = ""
			case "wrong token":
				token = "nope"
			case "a browser token on the webhook route":
				// Kind separation: the browser credential is a real,
				// valid bearer token on its own route and 401 here.
				token = "good"
			}
			status, body := fixture.post(t, token, `{"source":"ci"}`)
			if status != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401", status)
			}
			var decoded map[string]string
			if err := json.Unmarshal(body, &decoded); err != nil || decoded["code"] == "" {
				t.Fatalf("401 body = %s, want a usererror JSON with a code", body)
			}
		})
	}
	if _, _, calls := fixture.captured(); calls != 0 {
		t.Fatalf("sink called %d times on invalid tokens, want 0", calls)
	}
}

func TestWebhook_RejectsUnreadableBodies(t *testing.T) {
	fixture := newWebhookFixture(t)

	cases := map[string]string{
		"not JSON at all":    "oops",
		"a JSON array":       `[1,2,3]`,
		"a JSON scalar":      `"hello"`,
		"a truncated body":   `{"source":"ci"`,
		"an empty body":      "",
		"over the 64KiB cap": `{"padding":"` + strings.Repeat("x", 70*1024) + `"}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			status, _ := fixture.post(t, "webhook-good", body)
			if status != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", status)
			}
		})
	}
	if _, _, calls := fixture.captured(); calls != 0 {
		t.Fatalf("sink called %d times on unreadable bodies, want 0", calls)
	}
}

func TestWebhook_ValidPost_DispatchesValuesAndRawBody(t *testing.T) {
	fixture := newWebhookFixture(t)

	body := `{"source":"MyTool","title":"build done","attempts":3,"cached":true,"ratio":1.5,"nested":{"a":1},"list":[1,2],"empty":null}`
	status, respBody := fixture.post(t, "webhook-good", body)
	if status != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 (body=%s)", status, respBody)
	}

	values, raw, calls := fixture.captured()
	if calls != 1 {
		t.Fatalf("sink called %d times, want 1", calls)
	}
	wantValues := map[string]string{
		// Source is the trigger's exact-match key -- lower-cased before
		// dispatch so "MyTool" and "mytool" arm the same listeners.
		"source":   "mytool",
		"title":    "build done",
		"attempts": "3",
		"cached":   "true",
		"ratio":    "1.5",
	}
	if len(values) != len(wantValues) {
		t.Fatalf("values = %v, want exactly %v (nested objects, arrays and null never become attributes)", values, wantValues)
	}
	for key, want := range wantValues {
		if values[key] != want {
			t.Errorf("values[%q] = %q, want %q", key, values[key], want)
		}
	}
	if !bytes.Equal(raw, []byte(body)) {
		t.Errorf("raw = %s, want the posted body verbatim", raw)
	}
}

func TestWebhook_NoSinkWired_IsAServerError(t *testing.T) {
	// Unreachable from main.go's assembly, exercised so the route never
	// silently swallows a wiring fault.
	auth := &stubAuth{webhookToken: "webhook-good"}
	svc := bridgesvc.New(auth, slog.New(slog.DiscardHandler))
	srv := httptest.NewServer(svc.Handler())
	t.Cleanup(srv.Close)

	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, srv.URL+bridgesvc.WebhookPath, strings.NewReader(`{"source":"ci"}`))
	if err != nil {
		t.Fatalf("NewRequest() = %v, want nil error", err)
	}
	req.Header.Set("Authorization", "Bearer webhook-good")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST = %v, want nil error", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (a wiring fault, not a client error)", resp.StatusCode)
	}
}

func TestWebhook_GetIsRefused(t *testing.T) {
	fixture := newWebhookFixture(t)
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, fixture.srv.URL+bridgesvc.WebhookPath, nil)
	if err != nil {
		t.Fatalf("NewRequest() = %v, want nil error", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET = %v, want nil error", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", resp.StatusCode)
	}
}
