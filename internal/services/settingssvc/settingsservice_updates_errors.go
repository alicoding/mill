package settingssvc

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/net/html"
)

// updaterDiagnosisCap bounds how much of a sanitized provider error
// reaches a copyable-diagnosis payload -- same 4KB cap class as
// aiclient's truncate (internal/adapters/aiclient/openaicompat.go)
// applies to an unbounded non-2xx response body.
const updaterDiagnosisCap = 4096

// githubAPIErrorPattern matches the github provider's own error shape
// (wailsapp/wails/v3 pkg/updater/providers/github, fetchRelease's
// default branch: `fmt.Errorf("github: api %d: %s", status, body)`)
// wherever it appears in an updater.Check error chain -- Check wraps
// each provider failure ("<name>: %w") and joins every failure
// ("updater: all providers failed: ..."), so the match is unanchored
// at the start and anchored at the end, since body is always the
// final segment of the chain.
var githubAPIErrorPattern = regexp.MustCompile(`(?s)github: api (\d+): (.*)$`)

// sanitizeUpdaterError rewrites a github-provider error whose echoed
// body isn't JSON -- an HTML error page from an intermediate gateway
// (a 502/504, with an embedded base64 image) rendered whole in
// Settings > Updates -- into one humane line naming the source, the
// HTTP status, and a tag-stripped excerpt, capped at
// updaterDiagnosisCap. A JSON body (the API's normal error shape) or
// any error that doesn't match this provider's shape passes through
// unchanged.
func sanitizeUpdaterError(err error) error {
	if err == nil {
		return nil
	}
	m := githubAPIErrorPattern.FindStringSubmatch(err.Error())
	if m == nil {
		return err
	}
	status, convErr := strconv.Atoi(m[1])
	if convErr != nil {
		return err
	}
	body := strings.TrimSpace(m[2])
	if json.Valid([]byte(body)) {
		return err
	}

	excerpt := truncateDiagnosis(collapseWhitespace(htmlToPlainText(body)))
	msg := fmt.Sprintf("GitHub returned HTTP %d", status)
	if status >= 500 {
		msg += " -- try again in a moment"
	}
	if excerpt != "" {
		msg += ". " + excerpt
	} else {
		msg += "."
	}
	return errors.New(msg)
}

// htmlToPlainText extracts the readable text content of an HTML
// document, skipping non-visible elements (script/style/title) --
// walking only text nodes also means an element's attribute value
// (an <img>'s base64-encoded src, say) never reaches the output.
func htmlToPlainText(body string) string {
	doc, err := html.Parse(strings.NewReader(body))
	if err != nil {
		return ""
	}
	var sb strings.Builder
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			switch n.Data {
			case "script", "style", "title":
				return
			}
		}
		if n.Type == html.TextNode {
			sb.WriteString(n.Data)
			sb.WriteString(" ")
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	return sb.String()
}

// collapseWhitespace turns HTML's incidental indentation/newlines into
// single spaces, so a stripped excerpt reads as prose, not a source
// dump.
func collapseWhitespace(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// truncateDiagnosis caps s at updaterDiagnosisCap bytes -- the same
// cap class as aiclient's truncate, applied here to the sanitized
// (already tag-stripped) excerpt rather than a raw response body.
func truncateDiagnosis(s string) string {
	if len(s) <= updaterDiagnosisCap {
		return s
	}
	return s[:updaterDiagnosisCap] + "…"
}
