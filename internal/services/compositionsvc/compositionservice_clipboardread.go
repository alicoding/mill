package compositionsvc

import "github.com/alicoding/mill/internal/adapters/clipboard"

// readHostClipboardText is clipboard.ReadText's own swappable seam, the
// same shape internal/domain/composition/capture.go's readClipboardText
// already establishes -- a test pins a specific pasteboard reading
// instead of touching the real macOS clipboard.
var readHostClipboardText = clipboard.ReadText

// ReadHostClipboardText reads the OS pasteboard's plain-text flavor via
// the clipboard adapter (goal 0229) -- the door the Quick Panel's "Apply
// from clipboard..." row calls instead of navigator.clipboard.readText,
// which throws a permission error inside the panel's own auxiliary
// WKWebView (no permission model applies to a Go-side pasteboard read).
func (c *CompositionService) ReadHostClipboardText() (string, error) {
	return readHostClipboardText()
}
