package runbook

import (
	"errors"
	"strings"
	"testing"
)

// withFakeClipboard swaps the package-level clipboard function vars for the
// duration of a test, restoring the originals afterward. writeText is
// separate from writeHTML since the two actions use different clipboard
// flavors for their own Apply step (load-sample-html writes HTML,
// clipboard-html-to-markdown writes plain text).
func withFakeClipboard(t *testing.T, read func() (string, error), writeHTML, writeText func(string) error) {
	t.Helper()
	origRead, origWriteHTML, origWriteText := readClipboardHTML, writeClipboardHTML, writeClipboardText
	if read != nil {
		readClipboardHTML = read
	}
	if writeHTML != nil {
		writeClipboardHTML = writeHTML
	}
	if writeText != nil {
		writeClipboardText = writeText
	}
	t.Cleanup(func() {
		readClipboardHTML = origRead
		writeClipboardHTML = origWriteHTML
		writeClipboardText = origWriteText
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
	var textWriteCalled bool
	withFakeClipboard(t, nil, func(html string) error {
		written = html
		return nil
	}, func(string) error {
		textWriteCalled = true
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
	// Regression guard for the real bug this was hit as: a caller that
	// generically copies every action's return value to the clipboard
	// (e.g. HotkeyService's fire path, before the fix) would clobber the
	// real HTML this action just wrote with its own UI-facing status
	// text. This action must never call writeClipboardText itself.
	if textWriteCalled {
		t.Error("Run(load-sample-html) called writeClipboardText -- it must only write HTML via writeClipboardHTML, never overwrite it as plain text")
	}
}

func TestRun_LoadSampleHTML_WriteFails(t *testing.T) {
	withFakeClipboard(t, nil, func(string) error {
		return errors.New("boom")
	}, nil)

	_, err := Run("load-sample-html")
	if err == nil {
		t.Fatal("Run(load-sample-html) returned nil error when the clipboard write failed")
	}
}

func TestRun_ClipboardHTMLToMarkdown(t *testing.T) {
	var written string
	withFakeClipboard(t, func() (string, error) {
		return "<h2>Hi</h2><p>the <strong>bit</strong></p>", nil
	}, nil, func(md string) error {
		written = md
		return nil
	})

	result, err := Run("clipboard-html-to-markdown")
	if err != nil {
		t.Fatalf("Run(clipboard-html-to-markdown) returned error: %v", err)
	}
	if !strings.Contains(result, "## Hi") || !strings.Contains(result, "**bit**") {
		t.Errorf("Run(clipboard-html-to-markdown) result = %q, want converted markdown", result)
	}
	// This action owns its own Apply step: the converted markdown must
	// land on the clipboard as part of Run() succeeding, not depend on a
	// caller to separately copy the return value.
	if written != result {
		t.Errorf("writeClipboardText was called with %q, want it to match the returned markdown %q", written, result)
	}
}

func TestRun_ClipboardHTMLToMarkdown_WriteFails(t *testing.T) {
	withFakeClipboard(t, func() (string, error) {
		return "<h2>Hi</h2>", nil
	}, nil, func(string) error {
		return errors.New("boom")
	})

	_, err := Run("clipboard-html-to-markdown")
	if err == nil {
		t.Fatal("Run(clipboard-html-to-markdown) returned nil error when the clipboard write failed")
	}
}

func TestRun_ClipboardHTMLToMarkdown_NoHTMLOnClipboard(t *testing.T) {
	var textWriteCalled bool
	withFakeClipboard(t, func() (string, error) {
		return "", errors.New("no HTML on clipboard")
	}, nil, func(string) error {
		textWriteCalled = true
		return nil
	})

	// This is a soft-failure path by design: no HTML on the clipboard is a
	// normal, expected state (the user copied plain text), not an error --
	// it returns a friendly explanation with a nil error, not an error
	// value. Confirm that contract holds.
	result, err := Run("clipboard-html-to-markdown")
	if err != nil {
		t.Fatalf("Run(clipboard-html-to-markdown) with no clipboard HTML returned an error, want nil (soft-failure message instead): %v", err)
	}
	// Must not overwrite whatever the user actually had on the clipboard
	// with this explainer text -- there's nothing successful to Apply.
	if textWriteCalled {
		t.Error("Run(clipboard-html-to-markdown) called writeClipboardText on the no-HTML soft-failure path -- it must leave the clipboard untouched")
	}
	if !strings.Contains(result, "No HTML found") {
		t.Errorf("Run(clipboard-html-to-markdown) result = %q, want the no-HTML explanation", result)
	}
}
