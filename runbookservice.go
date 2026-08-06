package main

import (
	"encoding/hex"
	"fmt"
	"os/exec"
	"strings"

	htmltomarkdown "github.com/JohannesKaufmann/html-to-markdown/v2"
)

type Action struct {
	ID          string
	Name        string
	Description string
}

type RunbookService struct{}

func (r *RunbookService) List() []Action {
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

func (r *RunbookService) Run(id string) (string, error) {
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
	if err := writeClipboardHTML(sampleHTML); err != nil {
		return "", fmt.Errorf("writing sample HTML to clipboard: %w", err)
	}
	return "Sample HTML is now on your clipboard — here it is, exactly as written (what you see is what's really there):\n\n" + sampleHTML, nil
}

// readClipboardHTML asks macOS for the HTML flavor of the current clipboard
// contents. AppleScript returns raw AppleEvent data as a hex-encoded
// "«data HTMLxxxx»" literal, so it needs unwrapping before it's usable HTML.
func readClipboardHTML() (string, error) {
	out, err := exec.Command("osascript", "-e", "the clipboard as «class HTML»").Output()
	if err != nil {
		return "", fmt.Errorf("no HTML on clipboard: %w", err)
	}

	raw := strings.TrimSpace(string(out))
	raw = strings.TrimPrefix(raw, "«data HTML")
	raw = strings.TrimSuffix(raw, "»")

	decoded, err := hex.DecodeString(raw)
	if err != nil {
		return "", fmt.Errorf("could not decode clipboard HTML: %w", err)
	}
	return string(decoded), nil
}

// writeClipboardHTML is the inverse of readClipboardHTML: AppleScript sets
// the clipboard's HTML flavor from a hex-encoded "«data HTMLxxxx»" literal,
// the same encoding it hands back when reading.
func writeClipboardHTML(html string) error {
	script := "set the clipboard to «data HTML" + hex.EncodeToString([]byte(html)) + "»"
	if err := exec.Command("osascript", "-e", script).Run(); err != nil {
		return fmt.Errorf("osascript set-clipboard failed: %w", err)
	}
	return nil
}

func runClipboardHTMLToMarkdown() (string, error) {
	html, err := readClipboardHTML()
	if err != nil {
		return "No HTML found on the clipboard — only plain text (or nothing) was copied, so there's no structure to preserve. Copy something with real formatting (a heading, bold text, a list) and try again.", nil
	}

	markdown, err := htmltomarkdown.ConvertString(html)
	if err != nil {
		return "", fmt.Errorf("converting clipboard HTML to markdown: %w", err)
	}
	return markdown, nil
}
