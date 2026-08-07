package composition

import (
	"testing"
)

// withFakeClipboard is shared by execute_test.go and graph_test.go --
// both exercise nodeExec's clipboard-backed node types (directly, or via
// a Decision branch that routes into one).
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
