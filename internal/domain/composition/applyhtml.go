package composition

import (
	"github.com/alicoding/mill/internal/adapters/clipboard"
	"github.com/alicoding/mill/internal/domain/guardrail"
)

// Package-level function var, not a direct call -- same testability
// pattern as internal/domain/runbook.
var writeClipboardHTML = clipboard.WriteHTML

// sampleHTML is the default value for apply-clipboard-write-html's
// "html" field -- a demo fixture, not a fact anything else depends on.
const sampleHTML = `<h2>Quarterly update</h2>
<p>Here's a quick summary, with <strong>the important bit</strong> called out.</p>
<ul>
  <li>Runbook actions now support global keyboard shortcuts</li>
  <li>Clipboard capture preserves <em>real</em> structure, not flattened text</li>
  <li>The UI now runs on Primer, not hand-rolled CSS</li>
</ul>`

func init() {
	RegisterNodeType(NodeType{
		ID: "apply-clipboard-write-html", Kind: KindApply,
		Effect:      guardrail.ClassLocal,
		Label:       "Apply: write HTML to clipboard",
		Description: "Writes configured HTML to the clipboard.",
		ConfigFields: []ConfigField{
			{
				Key: "html", Label: "HTML to write",
				Multiline:   true,
				Description: "The HTML content this step puts on the clipboard.",
				Default:     sampleHTML,
				Type:        FieldText,
			},
		},
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		html := node.Config["html"]
		if err := writeClipboardHTML(html); err != nil {
			return ctx, err
		}
		ctx.Payload = html
		return ctx, nil
	})
}
