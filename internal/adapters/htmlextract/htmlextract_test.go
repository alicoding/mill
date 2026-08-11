package htmlextract

import (
	"strings"
	"testing"
)

const fixtureHTML = `<!DOCTYPE html>
<html>
<body>
<nav id="chrome-nav">Site navigation chrome</nav>
<main id="main-content">
<h1>Real heading</h1>
<ul><li>Real list item</li></ul>
</main>
<footer id="chrome-footer">Site footer chrome</footer>
</body>
</html>`

func TestExtract_MatchFound_SubtreeOnlyChromeDropped(t *testing.T) {
	out, err := Extract(fixtureHTML, "#main-content")
	if err != nil {
		t.Fatalf("Extract() error: %v", err)
	}
	if !strings.Contains(out, "Real heading") || !strings.Contains(out, "Real list item") {
		t.Errorf("Extract() = %q, want it to contain the main-content subtree", out)
	}
	if strings.Contains(out, "Site navigation chrome") || strings.Contains(out, "Site footer chrome") {
		t.Errorf("Extract() = %q, want the nav/footer chrome dropped", out)
	}
}

func TestExtract_CommaGroupSelector_PicksFirstPresentMatch(t *testing.T) {
	// Neither "#does-not-exist" nor "article" is present in the
	// fixture -- only "main" (via #main-content, which IS <main>) is,
	// proving the group falls through to whichever branch actually
	// matches rather than requiring every branch to be present.
	out, err := Extract(fixtureHTML, "#does-not-exist, main, article")
	if err != nil {
		t.Fatalf("Extract() error: %v", err)
	}
	if !strings.Contains(out, "Real heading") {
		t.Errorf("Extract() = %q, want the matched <main> subtree", out)
	}
}

func TestExtract_NoMatch_ErrorNamesSelector(t *testing.T) {
	_, err := Extract(fixtureHTML, "#nothing-here")
	if err == nil {
		t.Fatal("Extract() error = nil, want an error naming the selector")
	}
	if !strings.Contains(err.Error(), "#nothing-here") {
		t.Errorf("Extract() error = %q, want it to name the selector %q", err.Error(), "#nothing-here")
	}
}

func TestExtract_InvalidSelector_Errors(t *testing.T) {
	_, err := Extract(fixtureHTML, ":::not-a-selector:::")
	if err == nil {
		t.Fatal("Extract() error = nil, want an error for an unparseable selector")
	}
}
