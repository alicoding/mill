package runbook

import (
	"errors"
	"strings"
	"testing"
)

// withFakeClipboard swaps the package-level clipboard function vars for the
// duration of a test, restoring the originals afterward.
func withFakeClipboard(t *testing.T, read func() (string, error), write func(string) error) {
	t.Helper()
	origRead, origWrite := readClipboardHTML, writeClipboardHTML
	if read != nil {
		readClipboardHTML = read
	}
	if write != nil {
		writeClipboardHTML = write
	}
	t.Cleanup(func() {
		readClipboardHTML = origRead
		writeClipboardHTML = origWrite
	})
}

func TestList(t *testing.T) {
	actions := List()
	if len(actions) != 2 {
		t.Fatalf("List() returned %d actions, want 2", len(actions))
	}
	wantIDs := map[string]bool{"load-sample-html": false, "clipboard-html-to-markdown": false}
	for _, a := range actions {
		if _, ok := wantIDs[a.ID]; !ok {
			t.Errorf("List() returned unexpected action ID %q", a.ID)
		}
		wantIDs[a.ID] = true
		if a.Name == "" || a.Description == "" {
			t.Errorf("action %q has an empty Name or Description", a.ID)
		}
	}
	for id, seen := range wantIDs {
		if !seen {
			t.Errorf("List() is missing expected action %q", id)
		}
	}
}

func TestRun_UnknownAction(t *testing.T) {
	_, err := Run("does-not-exist")
	if err == nil {
		t.Fatal("Run(unknown id) returned nil error, want an error")
	}
}

func TestRun_LoadSampleHTML(t *testing.T) {
	var written string
	withFakeClipboard(t, nil, func(html string) error {
		written = html
		return nil
	})

	result, err := Run("load-sample-html")
	if err != nil {
		t.Fatalf("Run(load-sample-html) returned error: %v", err)
	}
	if written != sampleHTML {
		t.Errorf("writeClipboardHTML was called with %q, want the exact sampleHTML constant", written)
	}
	if !strings.Contains(result, "Quarterly update") {
		t.Errorf("Run(load-sample-html) result = %q, want it to echo the sample HTML back", result)
	}
}

func TestRun_LoadSampleHTML_WriteFails(t *testing.T) {
	withFakeClipboard(t, nil, func(string) error {
		return errors.New("boom")
	})

	_, err := Run("load-sample-html")
	if err == nil {
		t.Fatal("Run(load-sample-html) returned nil error when the clipboard write failed")
	}
}

func TestRun_ClipboardHTMLToMarkdown(t *testing.T) {
	withFakeClipboard(t, func() (string, error) {
		return "<h2>Hi</h2><p>the <strong>bit</strong></p>", nil
	}, nil)

	result, err := Run("clipboard-html-to-markdown")
	if err != nil {
		t.Fatalf("Run(clipboard-html-to-markdown) returned error: %v", err)
	}
	if !strings.Contains(result, "## Hi") || !strings.Contains(result, "**bit**") {
		t.Errorf("Run(clipboard-html-to-markdown) result = %q, want converted markdown", result)
	}
}

func TestRun_ClipboardHTMLToMarkdown_NoHTMLOnClipboard(t *testing.T) {
	withFakeClipboard(t, func() (string, error) {
		return "", errors.New("no HTML on clipboard")
	}, nil)

	// This is a soft-failure path by design: no HTML on the clipboard is a
	// normal, expected state (the user copied plain text), not an error --
	// it returns a friendly explanation with a nil error, not an error
	// value. Confirm that contract holds.
	result, err := Run("clipboard-html-to-markdown")
	if err != nil {
		t.Fatalf("Run(clipboard-html-to-markdown) with no clipboard HTML returned an error, want nil (soft-failure message instead): %v", err)
	}
	if !strings.Contains(result, "No HTML found") {
		t.Errorf("Run(clipboard-html-to-markdown) result = %q, want the no-HTML explanation", result)
	}
}
