// Package markdown wraps html-to-markdown behind Mill's own name, so
// swapping the library later (per CLAUDE.md's ports/adapters rule) never
// touches call sites.
package markdown

import (
	"strings"

	"github.com/JohannesKaufmann/html-to-markdown/v2/converter"
	"github.com/JohannesKaufmann/html-to-markdown/v2/plugin/base"
	"github.com/JohannesKaufmann/html-to-markdown/v2/plugin/commonmark"
	"github.com/JohannesKaufmann/html-to-markdown/v2/plugin/strikethrough"
	"github.com/JohannesKaufmann/html-to-markdown/v2/plugin/table"
)

// RuleSet is one named, switchable source-specific rule set -- the
// Pandoc-shaped named option a conversion profile turns on or off
// (goal 0305 slice 6). The default conversion applies every rule set.
type RuleSet struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

const (
	RuleSetConfluence = "confluence"
	RuleSetOffice     = "office"
)

// RuleSets lists the rule sets in the order a profile page shows them.
func RuleSets() []RuleSet {
	return []RuleSet{
		{ID: RuleSetConfluence, Label: "Confluence", Description: "Task lists, panels, expands, code macros, and emoticons from Confluence pages."},
		{ID: RuleSetOffice, Label: "Office and Word", Description: "Check boxes copied from Word, Outlook, OneNote, or Loop become task marks."},
	}
}

// Options selects which rule sets apply on top of the stock converter.
type Options struct {
	RuleSets []string
}

// DefaultOptions is every rule set -- quality lives in the defaults.
func DefaultOptions() Options {
	all := RuleSets()
	ids := make([]string, 0, len(all))
	for _, r := range all {
		ids = append(ids, r.ID)
	}
	return Options{RuleSets: ids}
}

// ToMarkdown converts HTML to Markdown with every rule set on --
// preserving structure (headings, bold, lists, tables, strikethrough)
// instead of flattening it to plain text. Built via
// converter.NewConverter with an explicit plugin list rather than the
// library's package-level ConvertString, which wires only
// base+commonmark and silently collapses every table to a single
// run-on line (no plugin/table).
func ToMarkdown(html string) (string, error) {
	return ToMarkdownWith(html, DefaultOptions())
}

// ToMarkdownWith converts with exactly the rule sets opts names (an
// unknown id is ignored; none means the stock converter alone).
func ToMarkdownWith(html string, opts Options) (string, error) {
	conv := converter.NewConverter(
		converter.WithPlugins(
			base.NewBasePlugin(),
			commonmark.NewCommonmarkPlugin(),
			table.NewTablePlugin(),
			strikethrough.NewStrikethroughPlugin(),
		),
	)
	on := map[string]bool{}
	for _, id := range opts.RuleSets {
		on[strings.TrimSpace(id)] = true
	}
	if on[RuleSetConfluence] {
		registerConfluenceRules(conv)
	}
	if on[RuleSetOffice] {
		registerOfficeRules(conv)
	}
	md, err := conv.ConvertString(html)
	if err != nil {
		return "", err
	}
	if on[RuleSetOffice] {
		md = officeTaskMarks(md)
	}
	return md, nil
}
