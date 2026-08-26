package compositionsvc

import (
	"fmt"
	"testing"
)

// swapReadHostClipboardText installs fn as readHostClipboardText for the
// duration of one test and restores the real clipboard.ReadText adapter
// afterward -- same swap/restore shape swapHTTPRequestLookup already
// establishes in this package.
func swapReadHostClipboardText(t *testing.T, fn func() (string, error)) {
	t.Helper()
	original := readHostClipboardText
	readHostClipboardText = fn
	t.Cleanup(func() { readHostClipboardText = original })
}

func TestReadHostClipboardText_ReturnsAdapterText(t *testing.T) {
	comp := newTestCompositionService(t)
	swapReadHostClipboardText(t, func() (string, error) { return "pasteboard contents", nil })

	got, err := comp.ReadHostClipboardText()
	if err != nil {
		t.Fatalf("ReadHostClipboardText: %v", err)
	}
	if got != "pasteboard contents" {
		t.Errorf("ReadHostClipboardText() = %q, want %q", got, "pasteboard contents")
	}
}

func TestReadHostClipboardText_PropagatesAdapterError(t *testing.T) {
	comp := newTestCompositionService(t)
	swapReadHostClipboardText(t, func() (string, error) { return "", fmt.Errorf("pbpaste failed: boom") })

	_, err := comp.ReadHostClipboardText()
	if err == nil {
		t.Fatal("ReadHostClipboardText() returned nil error, want the adapter's own failure propagated")
	}
}
