package composition

import (
	"github.com/alicoding/mill/internal/adapters/clipboard"
	"github.com/alicoding/mill/internal/domain/guardrail"
)

// Package-level function vars, not direct calls -- same testability
// pattern as internal/domain/runbook.
var readClipboardHTML = clipboard.ReadHTML
var readClipboardText = clipboard.ReadText

func init() {
	RegisterNodeType(NodeType{
		ID: "capture-clipboard-html", Kind: KindCapture,
		Effect:      guardrail.ClassRead,
		Complexity:  ComplexityBasic,
		Output:      "HTML from the clipboard",
		Label:       "Capture: clipboard HTML",
		Description: "Reads the clipboard's HTML. If there's no HTML flavor (many apps only put plain text), falls back to the plain-text flavor rather than failing -- the capture fallback order docs/SPEC.md §5 names (try HTML, then plain text; DOM-read via the browser bridge is the third tier, not built yet).",
	}, func(_ Node, ctx ExecContext) (ExecContext, error) {
		html, err := readClipboardHTML()
		if err == nil {
			ctx.Payload = html
			return ctx, nil
		}
		// No HTML flavor -- fall back to plain text (SPEC §5). Only if
		// THAT also fails is it a real "nothing usable on the clipboard"
		// error; surface the text-read error then, since it's the last
		// tier tried.
		text, textErr := readClipboardText()
		if textErr != nil {
			return ctx, textErr
		}
		ctx.Payload = text
		return ctx, nil
	})
}
