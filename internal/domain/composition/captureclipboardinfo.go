package composition

import (
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/adapters/clipboard"
	"github.com/alicoding/mill/internal/domain/guardrail"
)

// Package-level function var, not a direct call -- same testability
// pattern as capture.go's readClipboardHTML/readClipboardText.
var clipboardInfoFn = clipboard.Info

// formatClipboardInfo turns macOS's raw "clipboard info" report (a
// comma-separated list of alternating «class XXXX», byte-size pairs)
// into a human-readable summary: a yes/no line for the two flavors
// docs/SPEC.md §5's capture fallback order actually cares about (HTML,
// plain text), a blank separator, then the raw report verbatim -- so
// nothing the real pasteboard reported is lost, just made scannable.
// Pure and independently unit-tested against fixture strings, since the
// real pasteboard itself isn't CI-testable (same policy as
// internal/adapters/clipboard's own real-desktop-only tests).
func formatClipboardInfo(raw string) string {
	hasHTML := strings.Contains(raw, "«class HTML»")
	hasText := strings.Contains(raw, "string") || strings.Contains(raw, "«class utf8»")

	var b strings.Builder
	fmt.Fprintf(&b, "HTML flavor present: %s\n", yesNo(hasHTML))
	fmt.Fprintf(&b, "Plain text present: %s\n", yesNo(hasText))
	b.WriteString("\n")
	b.WriteString(raw)
	return b.String()
}

func yesNo(b bool) string {
	if b {
		return "yes"
	}
	return "no"
}

func init() {
	RegisterNodeType(NodeType{
		ID: "capture-clipboard-info", Kind: KindCapture,
		Effect:      guardrail.ClassRead,
		Output:      "a summary of the clipboard's flavors",
		Label:       "Capture: clipboard info",
		Description: "Reads macOS's own \"clipboard info\" report (which flavors -- HTML, plain text, images, ... -- are currently on the pasteboard, and their byte sizes) and summarizes whether HTML and plain text are present, followed by the raw report. A diagnostic for the Confluence-style clipboard ambiguity docs/SPEC.md §5 names: whether HTML was actually on the clipboard, made directly inspectable instead of inferred from a capture succeeding or failing.",
	}, func(_ Node, ctx ExecContext) (ExecContext, error) {
		raw, err := clipboardInfoFn()
		if err != nil {
			return ctx, err
		}
		ctx.Payload = formatClipboardInfo(raw)
		return ctx, nil
	})
}
