package httpconnector

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/hashicorp/go-retryablehttp"
)

// ExecuteConfined is Execute for a caller that may reach only named
// hosts (docs/goals/0288, a plugin's declared network): every hop --
// the request itself and every redirect -- must satisfy allowHost, or
// the call fails before any bytes leave; the response body is capped
// at maxBody bytes (a larger one is an error, never a silent
// truncation the caller could mistake for the whole). Same retry and
// timeout posture as Execute.
func ExecuteConfined(req Request, allowHost func(host string) bool, maxBody int64) (Response, error) {
	u, err := parseHTTPURL(req.URL)
	if err != nil {
		return Response{}, err
	}
	if !allowHost(u) {
		return Response{}, fmt.Errorf("host %q is not declared for this request", u)
	}
	c := newClient()
	c.HTTPClient.CheckRedirect = func(next *http.Request, _ []*http.Request) error {
		if next.URL.Scheme != "https" && next.URL.Scheme != "http" {
			return errors.New("redirect to a non-http(s) URL refused")
		}
		if !allowHost(strings.ToLower(next.URL.Host)) {
			return fmt.Errorf("redirect to undeclared host %q refused", next.URL.Host)
		}
		return nil
	}
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
	resp, err := c.Do(httpReq)
	if err != nil {
		return Response{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return Response{}, err
	}
	if int64(len(data)) > maxBody {
		return Response{}, fmt.Errorf("response body exceeds the %d byte limit", maxBody)
	}
	headers := make(map[string]string, len(resp.Header))
	for k := range resp.Header {
		headers[k] = resp.Header.Get(k)
	}
	return Response{StatusCode: resp.StatusCode, Body: string(data), Headers: headers}, nil
}

// parseHTTPURL returns the lowercased host of an http(s) URL, or an
// error for anything else (a file: or data: URL never reaches a host
// check).
func parseHTTPURL(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("invalid URL: %w", err)
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return "", fmt.Errorf("only http(s) URLs can be fetched, got %q", u.Scheme)
	}
	if u.Host == "" {
		return "", errors.New("URL has no host")
	}
	return strings.ToLower(u.Host), nil
}
