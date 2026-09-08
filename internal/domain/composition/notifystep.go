package composition

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

// notifierFn shows a notification -- injected so this domain package
// never touches the notify adapter or the notification spine directly
// (.claude/rules/backend.md); wiring connects it to the spine
// (notificationsvc.Publish), whose channels own the OS banner, the
// dock bounce and the phone. runID is the delivering run's own id for
// the record's SourceRef/DedupeKey, "" when unresolvable (a bare unit
// test with no current-run lookup wired degrades rather than failing).
// targets names the paired device ids (docs/goals/0372) this
// notification should reach; nil/empty reaches every paired device,
// the pre-existing broadcast behavior. Defaults to erroring so a node
// run before SetNotifier is wired fails loudly.
var notifierFn = func(title, body, runID string, targets []string) error {
	return fmt.Errorf("no notifier registered (yet)")
}

// SetNotifier wires the function apply-notify nodes use. Called once
// from main.go once NotificationService exists.
func SetNotifier(fn func(title, body, runID string, targets []string) error) {
	notifierFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "apply-notify", Kind: KindApply,
		PaletteGroup: PaletteGroupApply,
		Label:        "Notify me",
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
				Description: "The notification's first line. Use {{attribute}} to include a value.",
			},
			{
				Key: "titleAttribute", Label: "Title attribute (optional)", Type: FieldText,
				Description: "Which Attributes field replaces the fixed title, when set. Prefer {{attribute}} in the text.",
			},
			{
				Key: "body", Label: "Message", Type: FieldText,
				Description: "What the notification says. Use {{attribute}} to include a value.",
			},
			{
				Key: "bodyAttribute", Label: "Body attribute (optional)", Type: FieldText,
				Description: "Which Attributes field replaces the fixed message, when set. Prefer {{attribute}} in the text.",
			},
			{
				Key: "targets", Label: "Send to", Type: FieldArray,
				Description: "Leave empty to reach every paired device.",
				Items: &ConfigField{
					Type: FieldOptions, OptionsSource: "devices",
					// Needs "notification": only a device whose Accepts
					// names it is offered (docs/goals/0372 decision 3 --
					// today's whole vocabulary is a plain notification).
					Needs: []string{"notification"},
				},
			},
		},
	}, execNotify)
}

func execNotify(node Node, ctx ExecContext) (ExecContext, error) {
	vars := attributeVars(ctx.Attributes)
	gaps := newGapSet()

	title := node.Config["title"]
	if attr := node.Config["titleAttribute"]; attr != "" {
		if v, ok := ctx.Attributes[attr].(string); ok && v != "" {
			title = v
		}
	}
	var titleGaps []string
	var err error
	title, titleGaps, err = interpolateNotifyText(title, vars)
	if err != nil {
		return ctx, err
	}
	gaps.add(titleGaps)
	if title == "" {
		return ctx, fmt.Errorf("apply-notify: title is required")
	}
	body := node.Config["body"]
	if attr := node.Config["bodyAttribute"]; attr != "" {
		if v, ok := ctx.Attributes[attr].(string); ok && v != "" {
			body = v
		}
	}
	var bodyGaps []string
	body, bodyGaps, err = interpolateNotifyText(body, vars)
	if err != nil {
		return ctx, err
	}
	gaps.add(bodyGaps)

	var targets []string
	if raw := node.Config["targets"]; raw != "" {
		// Structured, never matched (.claude/rules/adopt-converged-
		// patterns.md's divergence list): the wire value is a JSON
		// array of device ids, parsed the same way ValidateValue
		// checks a TypeArray value, never string-split.
		if err := json.Unmarshal([]byte(raw), &targets); err != nil {
			return ctx, fmt.Errorf("apply-notify: targets: %w", err)
		}
	}
	if err := notifierFn(title, body, currentRunID(ctx.RunContext), targets); err != nil {
		return ctx, fmt.Errorf("apply-notify: %w", err)
	}
	if len(gaps.list) > 0 {
		attrs := make(map[string]any, len(ctx.Attributes)+1)
		for k, v := range ctx.Attributes {
			attrs[k] = v
		}
		attrs["notifyNote"] = notifyMissingNote(gaps.list)
		ctx.Attributes = attrs
	}
	return ctx, nil
}

// attributeVars converts the run's Attributes bag into the plain
// string map Interpolate needs, via the same any-to-string conversion
// resolveFieldSpec already applies for a list-sync template
// (applylistsync.go's stringifyPathValue) -- one conversion, reused
// rather than re-derived.
func attributeVars(attrs map[string]any) map[string]string {
	if len(attrs) == 0 {
		return nil
	}
	vars := make(map[string]string, len(attrs))
	for k, v := range attrs {
		vars[k] = stringifyPathValue(v)
	}
	return vars
}

// interpolateNotifyText resolves {{attribute}} references in a notify
// title/body through Interpolate -- the SAME function a request URL
// resolves its {{ENV}} references through -- and reports which names
// had nothing to resolve. A request URL leaves an unresolved
// reference literal so an operator sees exactly what failed to send;
// a notification is read text, so a name with no value renders empty
// here instead, via a second Interpolate pass over the same vars with
// the missing names blanked in (never a second grammar).
func interpolateNotifyText(s string, vars map[string]string) (string, []string, error) {
	result, missing := Interpolate(s, vars)
	if len(missing) == 0 {
		return result, nil, nil
	}
	capHint, err := boundedMapCapacity(len(vars), len(missing), "apply-notify")
	if err != nil {
		return "", nil, err
	}
	blanked := make(map[string]string, capHint)
	for k, v := range vars {
		blanked[k] = v
	}
	for _, name := range missing {
		blanked[name] = ""
	}
	result, _ = Interpolate(s, blanked)
	return result, missing, nil
}

// notifyMissingNote formats the run-detail note recorded under the
// step's Attributes when a {{attribute}} reference resolved to
// nothing -- one clause per name, in the order Interpolate reported
// them.
func notifyMissingNote(missing []string) string {
	notes := make([]string, len(missing))
	for i, name := range missing {
		notes[i] = fmt.Sprintf("{{%s}} had no value", name)
	}
	return strings.Join(notes, "; ")
}
