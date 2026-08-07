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
)

// timeout bounds every call -- an integration node that hangs forever on
// an unresponsive connector would silently stall the whole workflow;
// Mill's own guardrail philosophy (docs/SPEC.md §8) is fail-safe, not
// fail-open, and an unbounded outbound call is the opposite of that.
const timeout = 30 * time.Second

var client = &http.Client{Timeout: timeout}

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

// Response is the call's result, always returned alongside a nil error
// for any HTTP-level response (4xx/5xx included) -- only a transport
// failure (DNS, timeout, connection refused) is a Go error, matching
// net/http's own client.Do semantics; the caller decides what a non-2xx
// status means for its workflow, not this package.
type Response struct {
	StatusCode int
	Body       string
}

func Execute(req Request) (Response, error) {
	var bodyReader io.Reader
	if req.Body != "" {
		bodyReader = strings.NewReader(req.Body)
	}

	httpReq, err := http.NewRequest(req.Method, req.URL, bodyReader)
	if err != nil {
		return Response{}, err
	}
	for k, v := range req.Headers {
		httpReq.Header.Set(k, v)
	}

	resp, err := client.Do(httpReq)
	if err != nil {
		return Response{}, err
	}
	defer func() { _ = resp.Body.Close() }()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return Response{}, err
	}

	return Response{StatusCode: resp.StatusCode, Body: string(data)}, nil
}
