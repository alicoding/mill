package composition

import "github.com/alicoding/mill/internal/adapters/clipboard"

// Package-level function var, not a direct call -- same testability
// pattern as internal/domain/runbook.
var readClipboardHTML = clipboard.ReadHTML

func init() {
	RegisterNodeType(NodeType{
		ID: "capture-clipboard-html", Kind: KindCapture,
		Label:       "Capture: clipboard HTML",
		Description: "Reads whatever HTML is currently on the clipboard.",
	}, func(_ Node, ctx ExecContext) (ExecContext, error) {
		html, err := readClipboardHTML()
		if err != nil {
			return ctx, err
		}
		ctx.Payload = html
		return ctx, nil
	})
}
