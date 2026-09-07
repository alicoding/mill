package composition

import (
	"fmt"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

// notifierFn shows a notification -- injected so this domain package
// never touches the notify adapter or the notification spine directly
// (.claude/rules/backend.md); wiring connects it to the spine
// (notificationsvc.Publish), whose channels own the OS banner, the
// dock bounce and the phone. runID is the delivering run's own id for
// the record's SourceRef/DedupeKey, "" when unresolvable (a bare unit
// test with no current-run lookup wired degrades rather than failing).
// Defaults to erroring so a node run before SetNotifier is wired fails
// loudly.
var notifierFn = func(title, body, runID string) error {
	return fmt.Errorf("no notifier registered (yet)")
}

// SetNotifier wires the function apply-notify nodes use. Called once
// from main.go once NotificationService exists.
func SetNotifier(fn func(title, body, runID string) error) {
	notifierFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "apply-notify", Kind: KindApply,
		Label: "Notify me",
		// ClassLocal: a local side effect on the user's own machine and
		// their own paired devices, same class as the clipboard writes.
		Effect:     guardrail.ClassLocal,
		Complexity: ComplexityBasic,
		Consumes:   []PayloadKind{PayloadNone},
		Produces:   PayloadProduce{Passthrough: true},
		Output:     "payload unchanged; a notification appears on every channel, including a paired phone",
		Description: "Shows a notification when the workflow reaches this step. " +
			"\"Title attribute\" and \"Body attribute\" swap a fixed line for an Attributes value.",
		ConfigFields: []ConfigField{
			{
				Key: "title", Label: "Title", Type: FieldText,
				Description: "The notification's first line.",
			},
			{
				Key: "titleAttribute", Label: "Title attribute (optional)", Type: FieldText,
				Description: "Which Attributes field replaces the fixed title, when set.",
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
	if attr := node.Config["titleAttribute"]; attr != "" {
		if v, ok := ctx.Attributes[attr].(string); ok && v != "" {
			title = v
		}
	}
	if title == "" {
		return ctx, fmt.Errorf("apply-notify: title is required")
	}
	body := node.Config["body"]
	if attr := node.Config["bodyAttribute"]; attr != "" {
		if v, ok := ctx.Attributes[attr].(string); ok && v != "" {
			body = v
		}
	}
	if err := notifierFn(title, body, currentRunID(ctx.RunContext)); err != nil {
		return ctx, fmt.Errorf("apply-notify: %w", err)
	}
	return ctx, nil
}
