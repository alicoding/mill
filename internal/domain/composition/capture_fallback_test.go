package composition

import (
	"errors"
	"testing"
)

// capture-clipboard-html falls back to plain text when there's no HTML
// flavor (SPEC §5's capture fallback order), and only errors when text
// also fails. Uses the package-level read seams.
func TestCaptureClipboard_FallsBackToText(t *testing.T) {
	origHTML, origText := readClipboardHTML, readClipboardText
	t.Cleanup(func() { readClipboardHTML, readClipboardText = origHTML, origText })

	nodes := []Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "c", NodeTypeID: "capture-clipboard-html"},
	}
	edges := []Edge{{ID: "e", Source: "t", Target: "c"}}
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatal(err)
	}

	// HTML present: used directly, text never consulted.
	readClipboardHTML = func() (string, error) { return "<p>hi</p>", nil }
	readClipboardText = func() (string, error) { t.Fatal("text read when HTML was present"); return "", nil }
	if out, err := ExecuteWorkflow(resolved, edges, nil); err != nil || out != "<p>hi</p>" {
		t.Fatalf("html path: out=%q err=%v", out, err)
	}

	// No HTML flavor: falls back to plain text.
	readClipboardHTML = func() (string, error) { return "", errors.New("no HTML on clipboard") }
	readClipboardText = func() (string, error) { return "plain text here", nil }
	if out, err := ExecuteWorkflow(resolved, edges, nil); err != nil || out != "plain text here" {
		t.Fatalf("fallback path: out=%q err=%v", out, err)
	}

	// Neither flavor: the text-read error (the last tier) surfaces.
	readClipboardText = func() (string, error) { return "", errors.New("nothing on clipboard") }
	if _, err := ExecuteWorkflow(resolved, edges, nil); err == nil {
		t.Fatal("empty clipboard should error")
	}
}
