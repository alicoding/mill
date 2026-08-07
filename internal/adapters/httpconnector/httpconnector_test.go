package httpconnector

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
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

func TestExecute_NonOKStatus_NoError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("boom"))
	}))
	defer srv.Close()

	resp, err := Execute(Request{Method: http.MethodGet, URL: srv.URL})
	if err != nil {
		t.Fatalf("Execute returned error for a 500 response, want a nil error with the status/body surfaced: %v", err)
	}
	if resp.StatusCode != http.StatusInternalServerError || resp.Body != "boom" {
		t.Errorf("resp = %+v, want StatusCode=500 Body=%q", resp, "boom")
	}
}

func TestExecute_InvalidURL_Errors(t *testing.T) {
	if _, err := Execute(Request{Method: http.MethodGet, URL: "://not-a-url"}); err == nil {
		t.Error("Execute with an invalid URL returned nil error, want an error")
	}
}
