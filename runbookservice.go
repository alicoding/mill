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
			ID:          "clipboard-html-to-markdown",
			Name:        "Clipboard → Markdown",
			Description: "Reads the HTML on your clipboard and converts it to Markdown, preserving structure (headings, bold, lists) instead of flattening it to plain text.",
		},
	}
}

func (r *RunbookService) Run(id string) (string, error) {
	switch id {
	case "clipboard-html-to-markdown":
		return runClipboardHTMLToMarkdown()
	default:
		return "", fmt.Errorf("unknown action: %s", id)
	}
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
