package settingssvc

import (
	"errors"
	"strconv"
	"strings"
	"testing"
)

// githubGatewayTimeoutFixture is a trimmed copy of the HTML shape
// GitHub's edge returns for a 504 -- the real live repro (goal 0127's
// rider) carried a full <html> document with an embedded base64 <img>,
// which the updater's provider echoes verbatim into its error (see
// fetchRelease's default branch in the vendored
// wailsapp/wails/v3/pkg/updater/providers/github package).
const githubGatewayTimeoutFixture = `<html>
<head><title>504 Gateway Time-out</title></head>
<body>
<center><h1>504 Gateway Time-out</h1></center>
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" alt="">
<hr><center>nginx</center>
</body>
</html>`

// chainedGithubProviderError reproduces the exact wrapping
// updater.Check produces for a single-provider failure: Check wraps
// the provider's own error ("<name>: %w") and joins every failure
// into one message ("updater: all providers failed: ..."). The real
// bug only ever reaches sanitizeUpdaterError through this full chain,
// not the bare provider error, so the test exercises the same shape.
func chainedGithubProviderError(status int, body string) error {
	providerErr := "github: api " + strconv.Itoa(status) + ": " + body
	return errors.New("updater: all providers failed: github: " + providerErr)
}

func TestSanitizeUpdaterError_HTMLGatewayBody_VisibleLineIsHumaneAndBodyIsCapped(t *testing.T) {
	err := sanitizeUpdaterError(chainedGithubProviderError(504, githubGatewayTimeoutFixture))
	if err == nil {
		t.Fatal("sanitizeUpdaterError() = nil, want a sanitized error")
	}
	got := err.Error()

	// The visible line: source + status + the 5xx "try again" hint,
	// as one humane sentence a user reads without repo/HTTP knowledge.
	if !strings.HasPrefix(got, "GitHub returned HTTP 504 -- try again in a moment.") {
		t.Errorf("visible line = %q, want it to start with the humane GitHub/504/retry sentence", got)
	}

	// The raw HTML must never survive into the diagnosis payload --
	// this is the actual bug: the base64 image and markup dumped
	// straight into a paste buffer.
	for _, leaked := range []string{"<html", "<img", "base64", "<center>"} {
		if strings.Contains(got, leaked) {
			t.Errorf("sanitized error still contains raw markup %q: %q", leaked, got)
		}
	}

	// The stripped excerpt itself must still be there, readable.
	if !strings.Contains(got, "504 Gateway Time-out") {
		t.Errorf("sanitized error lost the page's own readable text: %q", got)
	}

	if len(got) > updaterDiagnosisCap+200 {
		t.Errorf("sanitized error is %d bytes, want it capped near updaterDiagnosisCap (%d)", len(got), updaterDiagnosisCap)
	}
}

func TestSanitizeUpdaterError_NonTransientStatus_NoRetryHint(t *testing.T) {
	err := sanitizeUpdaterError(chainedGithubProviderError(403, "<html><body>Forbidden</body></html>"))
	got := err.Error()
	if strings.Contains(got, "try again") {
		t.Errorf("4xx sanitized error = %q, want no transient-retry hint", got)
	}
	if !strings.HasPrefix(got, "GitHub returned HTTP 403.") {
		t.Errorf("visible line = %q, want the plain source+status sentence", got)
	}
}

func TestSanitizeUpdaterError_OversizedBody_StaysCapped(t *testing.T) {
	huge := strings.Repeat("padding text ", 1000) // well over updaterDiagnosisCap
	err := sanitizeUpdaterError(chainedGithubProviderError(504, "<html><body>"+huge+"</body></html>"))
	got := err.Error()
	if len(got) > updaterDiagnosisCap+200 {
		t.Errorf("oversized body sanitized error is %d bytes, want it capped near updaterDiagnosisCap (%d)", len(got), updaterDiagnosisCap)
	}
	if !strings.HasSuffix(got, "…") {
		t.Errorf("oversized body sanitized error = %q, want it to end with the truncation ellipsis", got)
	}
}

func TestSanitizeUpdaterError_JSONBody_PassesThroughUnchanged(t *testing.T) {
	original := chainedGithubProviderError(422, `{"message":"Validation Failed"}`)
	got := sanitizeUpdaterError(original)
	if got.Error() != original.Error() {
		t.Errorf("JSON-bodied error changed: got %q, want unchanged %q", got.Error(), original.Error())
	}
}

func TestSanitizeUpdaterError_UnrelatedError_PassesThroughUnchanged(t *testing.T) {
	original := errors.New("updater not configured")
	got := sanitizeUpdaterError(original)
	if got.Error() != original.Error() {
		t.Errorf("unrelated error changed: got %q, want unchanged %q", got.Error(), original.Error())
	}
}

func TestSanitizeUpdaterError_Nil_ReturnsNil(t *testing.T) {
	if got := sanitizeUpdaterError(nil); got != nil {
		t.Errorf("sanitizeUpdaterError(nil) = %v, want nil", got)
	}
}
