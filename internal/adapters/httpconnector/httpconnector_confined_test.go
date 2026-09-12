package httpconnector

import (
	"context"
	"crypto/tls"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestExecuteConfined_HostAndRedirectConfinement(t *testing.T) {
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("leaked")) }))
	defer other.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ok":
			w.Header().Set("X-Probe", "yes")
			_, _ = w.Write([]byte("hello"))
		case "/away":
			http.Redirect(w, r, other.URL+"/", http.StatusFound)
		case "/big":
			_, _ = w.Write([]byte(strings.Repeat("x", 2000)))
		}
	}))
	defer srv.Close()
	host := strings.TrimPrefix(srv.URL, "http://")
	allow := func(h string) bool { return h == host }

	res, err := ExecuteConfined(Request{Method: "GET", URL: srv.URL + "/ok"}, allow, 1000)
	if err != nil || res.StatusCode != 200 || res.Body != "hello" || res.Headers["X-Probe"] != "yes" {
		t.Fatalf("confined GET = %+v, %v", res, err)
	}
	if _, err := ExecuteConfined(Request{Method: "GET", URL: other.URL + "/"}, allow, 1000); err == nil || !strings.Contains(err.Error(), "not declared") {
		t.Errorf("undeclared host must be refused before the request: %v", err)
	}
	if _, err := ExecuteConfined(Request{Method: "GET", URL: srv.URL + "/away"}, allow, 1000); err == nil || !strings.Contains(err.Error(), "undeclared host") {
		t.Errorf("redirect off the declared host must be refused: %v", err)
	}
	if _, err := ExecuteConfined(Request{Method: "GET", URL: srv.URL + "/big"}, allow, 1000); !errors.Is(err, ErrResponseTooLarge) {
		t.Errorf("oversized body must error, never truncate: %v", err)
	}
	for _, bad := range []string{"file:///etc/passwd", "data:text/plain,hi", "not a url", "https://"} {
		if _, err := ExecuteConfined(Request{Method: "GET", URL: bad}, allow, 1000); err == nil {
			t.Errorf("%q must be refused", bad)
		}
	}
}

func TestExecuteConfined_NoRedirectNeverForwardsCredentials(t *testing.T) {
	var destinationCalls int
	destination := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		destinationCalls++
		if got := r.Header.Get("Authorization"); got != "" {
			t.Errorf("redirect destination received Authorization %q", got)
		}
	}))
	defer destination.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destination.URL+"/models", http.StatusFound)
	}))
	defer source.Close()
	allowBoth := func(host string) bool {
		return host == strings.TrimPrefix(source.URL, "http://") || host == strings.TrimPrefix(destination.URL, "http://")
	}

	res, err := ExecuteConfined(Request{
		Method: http.MethodGet, URL: source.URL + "/models",
		Headers: map[string]string{"Authorization": "Bearer inspection-key"}, NoRedirect: true,
	}, allowBoth, 1024)
	if err != nil {
		t.Fatalf("ExecuteConfined: %v", err)
	}
	if res.StatusCode != http.StatusFound {
		t.Fatalf("status = %d, want first-hop 302", res.StatusCode)
	}
	if destinationCalls != 0 {
		t.Fatalf("redirect destination received %d calls, want zero", destinationCalls)
	}
}

type confinedTLSResolver struct {
	wantContext any
	config      *tls.Config
	called      bool
}

func (r *confinedTLSResolver) ConfigFor(ctx context.Context, _ string) (*tls.Config, string, bool, error) {
	r.called = true
	if got := ctx.Value(confinedContextKey{}); got != r.wantContext {
		return nil, "", false, errors.New("request context was not forwarded to TLS selection")
	}
	return r.config, "confined-test", true, nil
}

type confinedContextKey struct{}

func TestExecuteConfined_ForwardsContextAndRetainsSelectedTLSClient(t *testing.T) {
	var calls int
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		_, _ = w.Write([]byte("secured"))
	}))
	defer srv.Close()
	serverTransport := srv.Client().Transport.(*http.Transport)
	resolver := &confinedTLSResolver{wantContext: "inspection", config: serverTransport.TLSClientConfig.Clone()}
	SetClientTLS(resolver)
	t.Cleanup(func() { SetClientTLS(nil) })

	ctx := context.WithValue(context.Background(), confinedContextKey{}, "inspection")
	host := strings.TrimPrefix(srv.URL, "https://")
	res, err := ExecuteConfined(Request{Method: http.MethodGet, URL: srv.URL, Context: ctx}, func(got string) bool { return got == host }, 1024)
	if err != nil {
		t.Fatalf("ExecuteConfined: %v", err)
	}
	if !resolver.called || res.Body != "secured" {
		t.Fatalf("resolver called=%v response=%+v", resolver.called, res)
	}
}

func TestExecuteConfined_CancellationStopsRetryWait(t *testing.T) {
	origMax, origMin, origMaxWait := retryMax, retryWaitMin, retryWaitMax
	retryMax, retryWaitMin, retryWaitMax = 3, time.Second, time.Second
	client = newClient()
	t.Cleanup(func() {
		retryMax, retryWaitMin, retryWaitMax = origMax, origMin, origMaxWait
		client = newClient()
	})

	firstAttempt := make(chan struct{})
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		if calls == 1 {
			close(firstAttempt)
		}
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := ExecuteConfined(Request{Method: http.MethodGet, URL: srv.URL, Context: ctx}, func(string) bool { return true }, 1024) //nolint:contextcheck // Request.Context is the transport seam under test.
		done <- err
	}()
	<-firstAttempt
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("error = %v, want context.Canceled", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("confined request kept waiting after cancellation")
	}
	if calls != 1 {
		t.Fatalf("server saw %d calls after cancellation, want one", calls)
	}
}
