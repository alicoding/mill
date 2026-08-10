package composition

import (
	"github.com/alicoding/mill/internal/adapters/clipboard"
	"github.com/alicoding/mill/internal/domain/guardrail"
)

// Package-level function var, not a direct call -- same testability
// pattern as internal/domain/runbook.
var writeClipboardText = clipboard.WriteText

func init() {
	RegisterNodeType(NodeType{
		ID: "apply-clipboard-write-text", Kind: KindApply,
		Effect:      guardrail.ClassLocal,
		Label:       "Apply: write plain text to clipboard",
		Description: "Writes the workflow's current payload to the clipboard as plain text.",
	}, func(_ Node, ctx ExecContext) (ExecContext, error) {
		if err := writeClipboardText(ctx.Payload); err != nil {
			return ctx, err
		}
		return ctx, nil
	})
}
