// Package runbook is Mill's own hand-written Capture -> Process -> Apply
// orchestration for Runbook actions (CLAUDE.md: core domain logic, never
// delegated to a library). It composes the clipboard and markdown adapters
// but owns the actual sequencing and copy shown to the user.
package runbook

import (
	"fmt"

	"github.com/alicoding/mill/internal/adapters/clipboard"
	"github.com/alicoding/mill/internal/adapters/markdown"
)

type Action struct {
	ID          string
	Name        string
	Description string
}

func List() []Action {
	return []Action{
		{
			ID:          "load-sample-html",
			Name:        "Load sample HTML (try it)",
			Description: "Puts a small formatted snippet (heading, bold, list) on your clipboard, so you can run Clipboard → Markdown below without needing to go find something to copy first.",
		},
		{
			ID:          "clipboard-html-to-markdown",
			Name:        "Clipboard → Markdown",
			Description: "Reads the HTML on your clipboard and converts it to Markdown, preserving structure (headings, bold, lists) instead of flattening it to plain text.",
		},
	}
}

func Run(id string) (string, error) {
	switch id {
	case "load-sample-html":
		return runLoadSampleHTML()
	case "clipboard-html-to-markdown":
		return runClipboardHTMLToMarkdown()
	default:
		return "", fmt.Errorf("unknown action: %s", id)
	}
}

// sampleHTML is deliberately small but structurally real: a heading, bold
// text, and a list — the exact shape that flattens to plain text when a
// source's clipboard HTML is missing or mishandled (the Confluence
// full-page-copy problem this whole Runbook action exists to test for).
const sampleHTML = `<h2>Quarterly update</h2>
<p>Here's a quick summary, with <strong>the important bit</strong> called out.</p>
<ul>
  <li>Runbook actions now support global keyboard shortcuts</li>
  <li>Clipboard capture preserves <em>real</em> structure, not flattened text</li>
  <li>The UI now runs on Primer, not hand-rolled CSS</li>
</ul>`

func runLoadSampleHTML() (string, error) {
	if err := clipboard.WriteHTML(sampleHTML); err != nil {
		return "", fmt.Errorf("writing sample HTML to clipboard: %w", err)
	}
	return "Sample HTML is now on your clipboard — here it is, exactly as written (what you see is what's really there):\n\n" + sampleHTML, nil
}

func runClipboardHTMLToMarkdown() (string, error) {
	html, err := clipboard.ReadHTML()
	if err != nil {
		return "No HTML found on the clipboard — only plain text (or nothing) was copied, so there's no structure to preserve. Copy something with real formatting (a heading, bold text, a list) and try again.", nil
	}

	md, err := markdown.ToMarkdown(html)
	if err != nil {
		return "", fmt.Errorf("converting clipboard HTML to markdown: %w", err)
	}
	return md, nil
}
