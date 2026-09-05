package composition

import (
	"github.com/alicoding/mill/internal/adapters/clipboard"
	"github.com/alicoding/mill/internal/domain/guardrail"
)

// Package-level function vars, not direct calls -- same testability
// pattern as internal/domain/runbook. clipboard.New() resolves to the
// in-memory Port inside a go test binary (goal 0356) -- never the real
// pasteboard by default.
var readClipboardHTML = clipboard.New().ReadHTML
var readClipboardText = clipboard.New().ReadText

func init() {
	RegisterNodeType(NodeType{
		ID: "capture-clipboard-html", Kind: KindCapture,
		Effect:      guardrail.ClassRead,
		Complexity:  ComplexityBasic,
		Consumes:    []PayloadKind{PayloadNone},
		Produces:    PayloadProduce{Kind: PayloadHTML},
		Output:      "HTML from the clipboard",
		Label:       "Read clipboard",
		Description: "Reads the clipboard's HTML. If there's no HTML flavor (many apps only put plain text), falls back to the plain-text flavor rather than failing.",
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
	// The plain-text sibling: an id, a token, a line copied as-is. The
	// HTML reader above prefers the HTML flavor, which a browser puts on
	// the clipboard for even one selected word -- wrong input for a
	// hash or an encoder.
	RegisterNodeType(NodeType{
		ID: "capture-clipboard-text", Kind: KindCapture,
		Effect:      guardrail.ClassRead,
		Complexity:  ComplexityBasic,
		Consumes:    []PayloadKind{PayloadNone},
		Produces:    PayloadProduce{Kind: PayloadText},
		Output:      "plain text from the clipboard",
		Label:       "Read clipboard text",
		Description: "Reads the clipboard's plain text only, never its HTML. Use it for ids, tokens, and anything copied as-is.",
	}, func(_ Node, ctx ExecContext) (ExecContext, error) {
		text, err := readClipboardText()
		if err != nil {
			return ctx, err
		}
		ctx.Payload = text
		return ctx, nil
	})
}
