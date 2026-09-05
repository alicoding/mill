// Package httpconnector executes one HTTP call on behalf of a
// composition integration-http node, using stdlib net/http per
// docs/SPEC.md §3.3's capability map ("wire protocol: adopt"). It has no
// knowledge of Connector/credential storage at all -- Headers already
// carries any auth header the caller resolved (see composition.go's
// integration-http nodeExec entry, which turns a Connector's AuthType +
// its keychain secret into the right header before calling Execute) --
// keeping this package a pure, commodity "do an HTTP call" utility, per
// CLAUDE.md's adapter boundary.
package httpconnector

import (
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/hashicorp/go-retryablehttp"
)

// timeout bounds every call -- an integration node that hangs forever on
// an unresponsive connector would silently stall the whole workflow;
// Mill's own guardrail philosophy (docs/SPEC.md §8) is fail-safe, not
// fail-open, and an unbounded outbound call is the opposite of that.
const timeout = 30 * time.Second

// retryMax/retryWaitMin/retryWaitMax match go-retryablehttp's own
// documented defaults closely (it ships 4/1s/30s) -- deliberately not
// tuned further than that without a real workload to tune against
// (SPEC.md §0's "don't build for a decision that doesn't exist yet",
// applied to config knobs, not just features). Package vars, not
// literals inlined in newClient, so the white-box test for the
// retries-exhausted path can shrink them instead of taking ~7s per run.
var (
	retryMax     = 3
	retryWaitMin = 1 * time.Second
	retryWaitMax = 10 * time.Second
)

var client = newClient()

func newClient() *retryablehttp.Client {
	c := retryablehttp.NewClient()
	c.HTTPClient.Timeout = timeout
	c.RetryMax = retryMax
	c.RetryWaitMin = retryWaitMin
	c.RetryWaitMax = retryWaitMax
	// Silences the library's own default logger (writes each retry
	// attempt to stderr) -- this adapter has no logger dependency of its
	// own to route through instead, and stderr noise from a commodity
	// HTTP client isn't something callers asked for. go-retryablehttp's
	// own DefaultRetryPolicy already does the right thing without any
	// extra config here -- read directly from client.go's
	// baseRetryPolicy, not assumed: retries most transport errors, 429
	// (Too Many Requests), and 5xx except 501 (Not Implemented, a
	// permanent "this isn't supported" response); every other 4xx falls
	// through unretried (a client error retrying itself into existence
	// doesn't make sense).
	c.Logger = nil
	return c
}

// Request is one fully-resolved HTTP call -- URL is the connector's
// BaseURL joined with the node's configured path, Headers already
// includes both the connector's static headers and its resolved auth
// header.
type Request struct {
	Method  string
	URL     string
	Headers map[string]string
	Body    string
}

// Response is the call's result, returned alongside a nil error for any
// HTTP-level response that go-retryablehttp doesn't itself retry to
// exhaustion -- most 4xx pass through untouched (the caller decides
// what a non-2xx status means for its workflow, not this package;
// composition/integration.go's exec function is where that judgment
// call lives, keeping this package a pure, opinion-free "do an HTTP
// call, with retries" commodity utility per CLAUDE.md's adapter
// boundary). A status the client DOES retry (429, 5xx except 501) that
// never succeeds within RetryMax attempts surfaces as a Go error
// instead, same as a transport failure (DNS, timeout, connection
// refused) -- verified directly against go-retryablehttp's own Do(),
// which returns (nil, err) with no Response at all once retries are
// exhausted, not the last failing response. Headers is included (not
// just Body) so a caller that needs to inspect e.g. rate-limit headers
// or a request-ID for debugging has it -- previously silently dropped.
type Response struct {
	StatusCode int
	Body       string
	Headers    map[string]string
}

func Execute(req Request) (Response, error) {
	var bodyReader io.Reader
	if req.Body != "" {
		bodyReader = strings.NewReader(req.Body)
	}

	httpReq, err := retryablehttp.NewRequest(req.Method, req.URL, bodyReader)
	if err != nil {
		return Response{}, err
	}
	for k, v := range req.Headers {
		httpReq.Header.Set(k, v)
	}

	// A host Mill holds a client certificate for goes out on its own
	// transport (tlsclient.go); every other host keeps the shared one.
	call, err := clientForRequest(httpReq.Context(), req.URL)
	if err != nil {
		return Response{}, err
	}
	resp, err := call.Do(httpReq)
	if err != nil {
		return Response{}, classifyTLSError(err)
	}
	defer func() { _ = resp.Body.Close() }()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return Response{}, err
	}

	headers := make(map[string]string, len(resp.Header))
	for k := range resp.Header {
		headers[k] = resp.Header.Get(k)
	}

	return Response{StatusCode: resp.StatusCode, Body: string(data), Headers: headers}, nil
}

// ExecuteStream issues req exactly like Execute (same client, same retry
// policy) but returns the LIVE response instead of buffering its body --
// aiclient's streaming Chat call reads Server-Sent Events off resp.Body
// as they arrive rather than waiting for the connection to close, which
// Execute's io.ReadAll would force. The caller owns resp.Body and must
// close it.
func ExecuteStream(req Request) (*http.Response, error) {
	var bodyReader io.Reader
	if req.Body != "" {
		bodyReader = strings.NewReader(req.Body)
	}

	httpReq, err := retryablehttp.NewRequest(req.Method, req.URL, bodyReader)
	if err != nil {
		return nil, err
	}
	for k, v := range req.Headers {
		httpReq.Header.Set(k, v)
	}

	call, err := clientForRequest(httpReq.Context(), req.URL)
	if err != nil {
		return nil, err
	}
	resp, err := call.Do(httpReq)
	if err != nil {
		return nil, classifyTLSError(err)
	}
	return resp, nil
}
