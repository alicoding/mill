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
		Complexity:  ComplexityBasic,
		Consumes:    []PayloadKind{PayloadNone},
		Produces:    PayloadProduce{Kind: PayloadText},
		Output:      "a summary of the clipboard's flavors",
		Label:       "Inspect clipboard",
		Description: "Reads the clipboard's own format report, listing which flavors (HTML, plain text, images) are present and their sizes, and summarizes whether HTML and plain text are available, followed by the raw report. A diagnostic for pastes that look right but convert wrong: see directly whether HTML was actually on the clipboard.",
	}, func(_ Node, ctx ExecContext) (ExecContext, error) {
		raw, err := clipboardInfoFn()
		if err != nil {
			return ctx, err
		}
		ctx.Payload = formatClipboardInfo(raw)
		return ctx, nil
	})
}
