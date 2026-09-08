package composition

import "github.com/alicoding/mill/internal/domain/seedorigin"

// builtInWebhookWorkflows returns the seeded proof for the hook door
// (goal 0368): trigger-webhook reacting to whatever an external tool
// posts, applying it to a notification on every channel including a
// paired phone. Split out of builtinworkflows.go once BuiltInWorkflows()
// crossed the 500-line convention, same split-file reasoning every
// other builtinworkflows_*.go file already follows.
func builtInWebhookWorkflows() []Workflow {
	// "Notify when a webhook fires": trigger-webhook catching every
	// source -> apply-notify. The workflow declares source/title/body
	// Attributes, so a post carrying those fields fills them by name;
	// apply-notify's title/body fallbacks cover a post that omits them.
	// Ships ENABLED: it is inert until a tool with a hook token posts.
	const (
		triggerID = "example-webhook-notify-trigger"
		notifyID  = "example-webhook-notify-notify"
	)
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: triggerID, NodeTypeID: "trigger-webhook", Position: Position{X: 0, Y: 0},
			Config: map[string]string{"source": ""}},
		{ID: notifyID, NodeTypeID: "apply-notify", Position: Position{X: 0, Y: 100},
			Config: map[string]string{
				"title":          "Agent event",
				"body":           "An agent tool fired a hook event.",
				"titleAttribute": "title",
				"bodyAttribute":  "body",
			}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return []Workflow{
		{
			ID:          "webhook-notify-workflow",
			Label:       "Notify when a webhook fires",
			Description: "Runs when an external tool posts to Mill's hook endpoint, using the fields it posted as the notification's title and body. Add a webhook token in Settings and point the tool at the hook endpoint shown in the hook recipe. Edit it like any workflow: change the message, scope it to one source, or disable it.",
			Nodes:       nodes,
			Attributes: []AttributeDef{
				{Key: "source", Label: "Source", Type: FieldText},
				{Key: "title", Label: "Title", Type: FieldText},
				{Key: "body", Label: "Body", Type: FieldText},
			},
			Edges: []Edge{
				{ID: "example-webhook-notify-e0", Source: triggerID, Target: notifyID},
			},
			BuiltIn: true,
			// Revision 7 (goal 0372): apply-notify gained a targets
			// ConfigField, whose default-filled "" now lands in this
			// seed's own persisted Config (ResolveNodeDefaults fills
			// every declared field).
			Seed: seedorigin.Stamp(7),
		},
	}
}

// builtInWebhookRespondWorkflows returns the seeded proof for the
// respond-webhook step (goal 0373): trigger-webhook waits for this
// workflow's own reply before answering the tool that posted the
// event. Ships ENABLED and inert: it only runs when a caller posts
// with source "example-reply", which nothing does until a real tool
// is pointed at it.
func builtInWebhookRespondWorkflows() []Workflow {
	const (
		triggerID = "example-webhook-respond-trigger"
		respondID = "example-webhook-respond-node"
	)
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: triggerID, NodeTypeID: "trigger-webhook", Position: Position{X: 0, Y: 0},
			Config: map[string]string{"source": "example-reply", "respondWithinSeconds": "30"}},
		{ID: respondID, NodeTypeID: RespondWebhookNodeTypeID, Position: Position{X: 0, Y: 100},
			Config: map[string]string{
				"status":      "200",
				"body":        `{"decision":"allow","reason":"Mill saw {{title}}"}`,
				"contentType": "application/json",
			}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return []Workflow{
		{
			ID:          "webhook-respond-workflow",
			Label:       "Example: Answer a webhook",
			Description: "Runs when a tool posts to Mill's hook endpoint with source \"example-reply\", and answers with a JSON decision the tool can read. Edit it like any workflow: change the reply, scope it to your own tool's source, or add steps before the reply to decide what it says.",
			Nodes:       nodes,
			Attributes: []AttributeDef{
				{Key: "title", Label: "Title", Type: FieldText},
			},
			Edges: []Edge{
				{ID: "example-webhook-respond-e0", Source: triggerID, Target: respondID},
			},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(1),
		},
	}
}
