package composition

import (
	"errors"
	"testing"
)

// withFakeClipboard is shared by execute_test.go and graph_test.go --
// both exercise nodeExec's clipboard-backed node types (directly, or via
// a Decision branch that routes into one).
var errClipboardTextUnset = errors.New("clipboard text seam not set in this test")

func withFakeClipboard(t *testing.T, read func() (string, error), writeHTML, writeText func(string) error) {
	t.Helper()
	origRead, origWriteHTML, origWriteText := readClipboardHTML, writeClipboardHTML, writeClipboardText
	origReadText := readClipboardText
	// Default the text fallback to "nothing there" so a test that only
	// stubs HTML doesn't accidentally hit the real pbpaste via the SPEC
	// §5 fallback -- individual tests override readClipboardText when
	// they exercise the fallback path.
	readClipboardText = func() (string, error) { return "", errClipboardTextUnset }
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
		readClipboardText = origReadText
		writeClipboardHTML = origWriteHTML
		writeClipboardText = origWriteText
	})
}
