package composition

import (
	"fmt"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

// appendClipboardHistoryFn defaults to a no-op so a run before
// SetClipboardHistoryAppender is wired (or a headless `go test` that
// never wires it) doesn't panic -- same pattern as redactSecretsFn
// (mcpcall.go).
var appendClipboardHistoryFn = func(string) error { return nil }

// SetClipboardHistoryAppender wires the function that persists one
// redacted clipboard-history entry (goal 0234,
// clipboardhistorysvc.ClipboardHistoryService.Append). Exported for
// main.go wiring only, never a frontend RPC.
//
//wails:ignore
func SetClipboardHistoryAppender(fn func(string) error) {
	appendClipboardHistoryFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "apply-clipboard-history-store", Kind: KindApply,
		Effect:      guardrail.ClassLocal,
		Complexity:  ComplexityBasic,
		Consumes:    []PayloadKind{PayloadText},
		Produces:    PayloadProduce{Passthrough: true},
		Output:      "the text it stored",
		Label:       "Save to clipboard history",
		Description: "Scrubs any known secret value out of the payload, then adds what's left to Clipboard history. Confidential-marked content and Mill's own clipboard writes never reach this step -- the trigger above already filtered them.",
	}, func(_ Node, ctx ExecContext) (ExecContext, error) {
		redacted := redactSecretsFn(ctx.Payload)
		if err := appendClipboardHistoryFn(redacted); err != nil {
			return ctx, fmt.Errorf("apply-clipboard-history-store: %w", err)
		}
		ctx.Payload = redacted
		return ctx, nil
	})
}
