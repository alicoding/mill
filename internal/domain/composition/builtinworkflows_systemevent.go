package composition

import (
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/seedorigin"
)

// builtInSystemEventWorkflows returns the seeded workflow exercising
// trigger-system-event (docs/adr/0035): the composed replacement for
// ForwardPendingApproval's deleted private send path. Split out of
// builtinworkflows.go once BuiltInWorkflows() crossed the 500-line
// convention -- see that function's own call site comment for the seam
// this follows.
func builtInSystemEventWorkflows() []Workflow {
	// "Example: Forward pending approvals" (docs/adr/0035 item 5, the
	// forward refactor's own proof): trigger-system-event(decision-parked)
	// -> integration-http against the same seeded no-auth HTTPRequest the
	// "Example: Approval-gated HTTP call" workflow already uses -- a
	// working placeholder a user re-points at their real notification
	// endpoint (ntfy/Telegram/a webhook receiver), not a dead stub.
	// integration-http's own body resolution (integration.go) forwards
	// ctx.Payload verbatim when neither the node nor the request configures
	// one, so the trigger's own JSON event -- {event, runId, workflowId,
	// workflowLabel, nodeId, timestamp} -- becomes the POST body with zero
	// templating needed. Ships DISABLED (ADR-0021's inactive state, same
	// as every other real-event-driven example) so it never fires against
	// a real endpoint until the user re-points the HTTPRequest and enables
	// it.
	const (
		forwardTriggerID = "example-forward-approvals-trigger"
		forwardHTTPID    = "example-forward-approvals-http"
	)
	forwardNodes, err := ResolveNodeDefaults([]Node{
		{ID: forwardTriggerID, NodeTypeID: "trigger-system-event", Position: Position{X: 0, Y: 0},
			Config: map[string]string{"event": "decision-parked", "workflowScope": ""}},
		{ID: forwardHTTPID, NodeTypeID: "integration-http", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"requestId": httprequest.ExampleNoneID}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	const (
		updateTriggerID = "update-available-trigger"
		updateNotifyID  = "update-available-notify"
	)
	updateNodes, err := ResolveNodeDefaults([]Node{
		{ID: updateTriggerID, NodeTypeID: "trigger-system-event", Position: Position{X: 0, Y: 0},
			Config: map[string]string{"event": "update-available", "workflowScope": ""}},
		{ID: updateNotifyID, NodeTypeID: "apply-notify", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"title": "Mill update", "body": "A new Mill version is ready. Open Settings → Updates to install."}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return []Workflow{
		{
			ID:          "update-available-notify-workflow",
			Label:       "Notify when an update is available",
			Description: "Fires when an update check finds a newer Mill release on your channel and shows a notification. Edit it like any workflow: change the message, add conditions, or forward to another device through an integration; disable it if the footer badge is enough.",
			Nodes:       updateNodes,
			Edges: []Edge{
				{ID: "update-available-notify-e0", Source: updateTriggerID, Target: updateNotifyID},
			},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(2),
		},
		{
			ID:          "example-forward-approvals-workflow",
			Label:       "Example: Forward pending approvals",
			Description: "Fires whenever ANY workflow parks awaiting approval and POSTs the event ({event, runId, workflowId, workflowLabel, nodeId, timestamp}) to the integration below. Re-point \"Integration\" (canvas Inspector) at your real notification endpoint (ntfy/Telegram/a webhook receiver you configure under Configure > Integrations), then enable this workflow. It ships DISABLED so it never calls out anywhere until you do. Replaces the old Settings > Forward pending approvals toggle: this workflow IS the forward now, visible and editable like any other, instead of a private code path.",
			Nodes:       forwardNodes,
			Edges: []Edge{
				{ID: "example-forward-approvals-e0", Source: forwardTriggerID, Target: forwardHTTPID},
			},
			BuiltIn:  true,
			Seed:     seedorigin.Stamp(3),
			Disabled: true,
		},
	}
}
