package composition

import "github.com/alicoding/mill/internal/domain/seedorigin"

// builtInLifecycleWorkflows returns the seeded proof for the entity/
// object lifecycle event family (docs/goals/0392 Decision 4):
// "Example: tidy unused lists" fires on trigger-system-event's own
// entity.dereferenced, and a Branch step (decision-route) narrows the
// stream to the one case worth acting on -- a list whose last board
// reference was just removed. Ships ENABLED: a local notification
// carries no outbound risk, the same posture "Notify when an update is
// available" already takes; apply-notify has no inline templating (only
// a whole-field titleAttribute/bodyAttribute swap), so the copy is
// fixed rather than naming the list, matching that same workflow's
// precedent for a generic platform notice.
func builtInLifecycleWorkflows() []Workflow {
	const (
		triggerID   = "example-tidy-unused-lists-trigger"
		routeID     = "example-tidy-unused-lists-route"
		notifyID    = "example-tidy-unused-lists-notify"
		otherwiseID = "example-tidy-unused-lists-otherwise"
	)
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: triggerID, NodeTypeID: "trigger-system-event", Position: Position{X: 0, Y: 0},
			Config: map[string]string{"event": "entity.dereferenced", "workflowScope": ""}},
		{ID: routeID, NodeTypeID: "decision-route", Position: Position{X: 0, Y: 100}},
		{ID: notifyID, NodeTypeID: "apply-notify", Position: Position{X: -120, Y: 200},
			Config: map[string]string{
				"title": "List no longer used",
				"body":  "A list is no longer on any board or workflow. Delete it in Configure if you don't need it.",
			}},
		{ID: otherwiseID, NodeTypeID: "process-inject-text", Position: Position{X: 120, Y: 200},
			Config: map[string]string{"text": "(still referenced elsewhere)", "placement": "append"}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return []Workflow{
		{
			ID:          "example-tidy-unused-lists-workflow",
			Label:       "Example: tidy unused lists",
			Description: "Fires when a list stops being referenced by a board table, and notifies you to review it in Configure once nothing else references it either.",
			Nodes:       nodes,
			Attributes: []AttributeDef{
				{Key: "entityKind", Label: "Entity kind (written by the trigger)", Type: FieldText, Description: "Which Configure entity family lost a reference. \"list\" for a table object."},
				{Key: "remaining", Label: "Remaining references (written by the trigger)", Type: FieldNumber, Description: "How many board objects or workflows still reference it after this removal. 0 means nothing does."},
			},
			Edges: []Edge{
				{ID: "example-tidy-unused-lists-e0", Source: triggerID, Target: routeID},
				{ID: "example-tidy-unused-lists-e1", Source: routeID, SourceHandle: `entityKind == "list" && remaining == 0`, Target: notifyID},
				{ID: "example-tidy-unused-lists-e2", Source: routeID, SourceHandle: otherwiseHandle, Target: otherwiseID},
			},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(1),
		},
	}
}
