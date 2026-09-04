package composition

import (
	"fmt"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

// notifierFn shows a local OS notification -- injected so this domain
// package never touches the notify adapter directly
// (.claude/rules/backend.md); settingssvc owns the adapter's lifecycle
// (permission handshake, server-mode no-op). Defaults to erroring so a
// node run before SetNotifier is wired fails loudly.
var notifierFn = func(title, body string) error {
	return fmt.Errorf("no notifier registered (yet)")
}

// SetNotifier wires the function apply-notify nodes use. Called once
// from main.go once SettingsService exists.
func SetNotifier(fn func(title, body string) error) {
	notifierFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "apply-notify", Kind: KindApply,
		Label: "Notify me",
		// ClassLocal: a local OS side effect on the user's own machine,
		// same class as the clipboard writes.
		Effect:     guardrail.ClassLocal,
		Complexity: ComplexityBasic,
		Consumes:   []PayloadKind{PayloadNone},
		Produces:   PayloadProduce{Passthrough: true},
		Output:     "payload unchanged; a notification appears on this machine",
		Description: "Shows a notification when the workflow reaches this step. " +
			"\"Body attribute\" swaps the fixed message for an Attributes value.",
		ConfigFields: []ConfigField{
			{
				Key: "title", Label: "Title", Type: FieldText,
				Description: "The notification's first line.",
			},
			{
				Key: "body", Label: "Message", Type: FieldText,
				Description: "What the notification says.",
			},
			{
				Key: "bodyAttribute", Label: "Body attribute (optional)", Type: FieldText,
				Description: "Which Attributes field replaces the fixed message, when set.",
			},
		},
	}, execNotify)
}

func execNotify(node Node, ctx ExecContext) (ExecContext, error) {
	title := node.Config["title"]
	if title == "" {
		return ctx, fmt.Errorf("apply-notify: title is required")
	}
	body := node.Config["body"]
	if attr := node.Config["bodyAttribute"]; attr != "" {
		if v, ok := ctx.Attributes[attr].(string); ok && v != "" {
			body = v
		}
	}
	if err := notifierFn(title, body); err != nil {
		return ctx, fmt.Errorf("apply-notify: %w", err)
	}
	return ctx, nil
}
