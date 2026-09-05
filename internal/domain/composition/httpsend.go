package composition

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/alicoding/mill/internal/adapters/httpconnector"
)

// defaultMethodAndPath resolves an HTTPRequest's transport method/path,
// same precedence integration-http's exec has always used: an explicit
// override (a node's own persisted config, for the legacy
// path/method-authoring case) wins, then the request's own declaration
// (Method field, or its single declared operation's path/method), then
// GET/empty. Shared so decision-outcome's webhook call (which has no
// node-level override at all -- it always passes "") resolves
// identically to a plain integration-http call against the same
// request.
func defaultMethodAndPath(rc ResolvedHTTPRequest, overrideMethod, overridePath string) (method, path string) {
	method, path = overrideMethod, overridePath
	if method == "" {
		method = rc.Method
	}
	if rc.OpenAPISpec != "" {
		if opPath, opMethod, ok := singleOperation(rc.OpenAPISpec); ok {
			if path == "" {
				path = opPath
			}
			if method == "" {
				method = opMethod
			}
		}
	}
	if method == "" {
		method = http.MethodGet
	}
	return method, path
}

// sendHTTPRequest is the shared HTTP transport tail integration-http
// and decision-outcome's webhook both execute through (docs/adr/0027:
// "the SAME execution path integration-http uses") -- JOSE-encrypt the
// body, apply auth (ADR-0015, signs the final path/body), assemble the
// URL (JoinRequestURL + path-param substitution + query), call
// httpconnector, fail-safe on a non-2xx status (SPEC.md §8's
// philosophy, matching n8n's own HTTP Request node default), and
// JOSE-decrypt the response. headers/query are mutated in place (an
// auth strategy may add to either) -- callers pass a fresh map/Values
// per call, never a shared one.
func sendHTTPRequest(rc ResolvedHTTPRequest, method, urlPath, body string, headers map[string]string, query url.Values, pathParams map[string]string) (string, error) {
	body, err := ApplyJOSEEncryption(rc.JOSE, rc.JOSERecipientPublicKeyPEM, body)
	if err != nil {
		return "", err
	}
	if err := ApplyAuth(rc, method, urlPath, headers, query, body); err != nil {
		return "", err
	}

	fullURL := JoinRequestURL(rc.BaseURL, urlPath)
	for name, val := range pathParams {
		fullURL = strings.ReplaceAll(fullURL, "{"+name+"}", val)
	}
	if len(query) > 0 {
		fullURL += "?" + query.Encode()
	}

	resp, err := httpconnector.Execute(httpconnector.Request{
		Method:  method,
		URL:     fullURL,
		Headers: headers,
		Body:    body,
	})
	if err != nil {
		return "", err
	}
	// A header carrying a vault-resolved value (goal 0203 S1) could be
	// echoed back by the server -- both the response body and the
	// non-2xx error text below are redacted against every currently-
	// known vault secret before either reaches ctx.Payload or an error
	// message, the same safety net codeexec.go's own captured output
	// applies (goal 0185 S4). Redacted after JOSE decryption, never
	// before: redacting ciphertext bytes could corrupt a coincidental
	// byte match and break decryption.
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("request failed with status %d: %s", resp.StatusCode, redactSecretsFn(resp.Body))
	}
	decrypted, err := DecryptJOSEResponse(rc.JOSE, rc.JOSEPrivateKeyPEM, resp.Body)
	if err != nil {
		return "", err
	}
	return redactSecretsFn(decrypted), nil
}
