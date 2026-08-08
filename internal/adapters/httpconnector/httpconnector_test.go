package httpconnector

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestExecute_GET_ReturnsBodyAndStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	resp, err := Execute(Request{Method: http.MethodGet, URL: srv.URL})
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Errorf("StatusCode = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	if resp.Body != `{"ok":true}` {
		t.Errorf("Body = %q, want %q", resp.Body, `{"ok":true}`)
	}
}

func TestExecute_SendsHeaders(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	_, err := Execute(Request{Method: http.MethodGet, URL: srv.URL, Headers: map[string]string{"Authorization": "Bearer tok123"}})
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}
	if gotAuth != "Bearer tok123" {
		t.Errorf("received Authorization header = %q, want %q", gotAuth, "Bearer tok123")
	}
}

func TestExecute_SendsBody(t *testing.T) {
	var gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	_, err := Execute(Request{Method: http.MethodPost, URL: srv.URL, Body: `{"name":"mill"}`})
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}
	if gotBody != `{"name":"mill"}` {
		t.Errorf("received body = %q, want %q", gotBody, `{"name":"mill"}`)
	}
}

// ADR-0016 Phase C: RFC 10008's QUERY method (published June 2026)
// carries a request body like POST but isn't one of net/http's
// pre-defined method constants -- proves directly, not assumed, that
// Execute (and the retryablehttp.NewRequest/http.NewRequest chain
// underneath it) sends a body on an arbitrary non-standard method
// string exactly like it does for POST, since neither actually
// special-cases the method when attaching a body.
func TestExecute_QueryMethod_SendsBody(t *testing.T) {
	var gotMethod, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"results":[]}`))
	}))
	defer srv.Close()

	resp, err := Execute(Request{Method: "QUERY", URL: srv.URL, Body: `{"filter":{"status":"active"}}`})
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}
	if gotMethod != "QUERY" {
		t.Errorf("server received method %q, want QUERY", gotMethod)
	}
	if gotBody != `{"filter":{"status":"active"}}` {
		t.Errorf("server received body %q, want the QUERY body", gotBody)
	}
	if resp.StatusCode != http.StatusOK || resp.Body != `{"results":[]}` {
		t.Errorf("resp = %+v, want a normal 200 response", resp)
	}
}

// go-retryablehttp's DefaultRetryPolicy doesn't retry a plain 400 (only
// 429 and 5xx-except-501 are retryable, verified directly against its
// source -- see httpconnector.go's own newClient comment), so this
// covers the "pass a non-retried HTTP-level response through as data"
// contract composition/integration.go's status check depends on.
func TestExecute_NonRetriedStatus_NoError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("boom"))
	}))
	defer srv.Close()

	resp, err := Execute(Request{Method: http.MethodGet, URL: srv.URL})
	if err != nil {
		t.Fatalf("Execute returned error for a non-retried 400 response, want a nil error with the status/body surfaced: %v", err)
	}
	if resp.StatusCode != http.StatusBadRequest || resp.Body != "boom" {
		t.Errorf("resp = %+v, want StatusCode=400 Body=%q", resp, "boom")
	}
}

// A persistently-failing retryable status (500) that never recovers
// within RetryMax attempts surfaces as a Go error, not a Response --
// verified directly against go-retryablehttp's own Do(), which drops
// the response once retries are exhausted (see the Response doc
// comment). Shrinks the package's retry tunables for the duration of
// this test so it doesn't cost ~7s of real backoff per run.
func TestExecute_RetriedStatusExhausted_Errors(t *testing.T) {
	origMax, origMin, origMax2 := retryMax, retryWaitMin, retryWaitMax
	retryMax, retryWaitMin, retryWaitMax = 1, time.Millisecond, time.Millisecond
	client = newClient()
	t.Cleanup(func() {
		retryMax, retryWaitMin, retryWaitMax = origMax, origMin, origMax2
		client = newClient()
	})

	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("boom"))
	}))
	defer srv.Close()

	_, err := Execute(Request{Method: http.MethodGet, URL: srv.URL})
	if err == nil {
		t.Fatal("Execute returned nil error for a 500 that exhausted retries, want an error")
	}
	if calls < 2 {
		t.Errorf("server saw %d call(s), want at least 2 (an initial attempt plus retries)", calls)
	}
}

func TestExecute_InvalidURL_Errors(t *testing.T) {
	if _, err := Execute(Request{Method: http.MethodGet, URL: "://not-a-url"}); err == nil {
		t.Error("Execute with an invalid URL returned nil error, want an error")
	}
}
