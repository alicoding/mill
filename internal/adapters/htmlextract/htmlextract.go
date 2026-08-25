// Package htmlextract wraps goquery behind Mill's own name (CLAUDE.md's
// ports/adapters rule), so extracting one subtree out of a captured HTML
// document -- e.g. a saved web page's main-content region, stripping
// nav/header/footer chrome -- never leaks the underlying library into
// domain code.
package htmlextract

import (
	"fmt"
	"strings"

	"github.com/PuerkitoBio/goquery"
	"github.com/andybalholm/cascadia"
)

// Extract parses html and returns the outer HTML of the FIRST element
// matching selector (a plain CSS selector, optionally a comma-separated
// group -- e.g. "#main-content, main, article" -- matched in document
// order, first present wins). Two distinct, clearly-worded error cases,
// so a run's step error is self-explanatory: an unparseable selector
// (caught before ever querying the document, since goquery's own Find
// silently treats a bad selector as "matches nothing" rather than
// erroring) and a selector that parses but matches nothing in this
// particular document.
func Extract(html, selector string) (string, error) {
	// Validate the selector before running it against the document --
	// goquery.Selection.Find swallows a cascadia parse error into an
	// always-empty match set internally, so without this check an
	// invalid selector and a valid-but-absent one would be
	// indistinguishable to the caller.
	if _, err := cascadia.Compile(selector); err != nil {
		return "", fmt.Errorf("htmlextract: invalid selector %q: %w", selector, err)
	}

	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return "", fmt.Errorf("htmlextract: parse HTML: %w", err)
	}

	sel := doc.Find(selector).First()
	if sel.Length() == 0 {
		return "", fmt.Errorf("htmlextract: no element matched selector %q", selector)
	}

	out, err := goquery.OuterHtml(sel)
	if err != nil {
		return "", fmt.Errorf("htmlextract: render matched element: %w", err)
	}
	return out, nil
}

// Parse parses html and returns its root selection -- the underlying
// parsed document's own embedded Selection, never the document value
// itself, so a caller that only ever needs Selection-family methods
// (Find, Children, walking a whole fragment) never has to import
// goquery's own parse entry point directly.
func Parse(html string) (*goquery.Selection, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil, fmt.Errorf("htmlextract: parse HTML: %w", err)
	}
	return doc.Selection, nil
}
