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

// hooksFixture wires the hook door with a captured sink, the same half
// of main.go's assembly these ingress tests pin.
type hooksFixture struct {
	srv *httptest.Server

	mu     sync.Mutex
	values map[string]string
	raw    []byte
	calls  int
}

func newHooksFixture(t *testing.T) *hooksFixture {
	t.Helper()
	auth := &stubAuth{token: "good", hookToken: "hook-good"}
	fixture := &hooksFixture{}
	svc := bridgesvc.New(auth, slog.New(slog.DiscardHandler))
	svc.SetWebhookEventSink(func(values map[string]string, raw []byte) {
		fixture.mu.Lock()
		fixture.values, fixture.raw = values, raw
		fixture.calls++
		fixture.mu.Unlock()
	})
	srv := httptest.NewServer(svc.Handler())
	t.Cleanup(srv.Close)
	fixture.srv = srv
	return fixture
}

func (f *hooksFixture) post(t *testing.T, token, body string) (int, []byte) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, f.srv.URL+bridgesvc.HookEventPath, strings.NewReader(body))
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

func (f *hooksFixture) captured() (map[string]string, []byte, int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.values, f.raw, f.calls
}

func TestHookEvent_RequiresAHookToken(t *testing.T) {
	fixture := newHooksFixture(t)

	for _, name := range []string{"no header", "wrong token", "a browser token on the hook route"} {
		t.Run(name, func(t *testing.T) {
			var token string
			switch name {
			case "no header":
				token = ""
			case "wrong token":
				token = "nope"
			case "a browser token on the hook route":
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

func TestHookEvent_RejectsUnreadableBodies(t *testing.T) {
	fixture := newHooksFixture(t)

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
			status, _ := fixture.post(t, "hook-good", body)
			if status != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", status)
			}
		})
	}
	if _, _, calls := fixture.captured(); calls != 0 {
		t.Fatalf("sink called %d times on unreadable bodies, want 0", calls)
	}
}

func TestHookEvent_ValidPost_DispatchesValuesAndRawBody(t *testing.T) {
	fixture := newHooksFixture(t)

	body := `{"source":"MyTool","title":"build done","attempts":3,"cached":true,"ratio":1.5,"nested":{"a":1},"list":[1,2],"empty":null}`
	status, respBody := fixture.post(t, "hook-good", body)
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

func TestHookEvent_NoSinkWired_IsAServerError(t *testing.T) {
	// Unreachable from main.go's assembly, exercised so the route never
	// silently swallows a wiring fault.
	auth := &stubAuth{hookToken: "hook-good"}
	svc := bridgesvc.New(auth, slog.New(slog.DiscardHandler))
	srv := httptest.NewServer(svc.Handler())
	t.Cleanup(srv.Close)

	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, srv.URL+bridgesvc.HookEventPath, strings.NewReader(`{"source":"ci"}`))
	if err != nil {
		t.Fatalf("NewRequest() = %v, want nil error", err)
	}
	req.Header.Set("Authorization", "Bearer hook-good")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST = %v, want nil error", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (a wiring fault, not a client error)", resp.StatusCode)
	}
}

func TestHookEvent_GetIsRefused(t *testing.T) {
	fixture := newHooksFixture(t)
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, fixture.srv.URL+bridgesvc.HookEventPath, nil)
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
