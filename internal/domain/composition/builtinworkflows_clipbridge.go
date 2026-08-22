package composition

import "github.com/alicoding/mill/internal/domain/seedorigin"

// The clipboard bridge's two seeded ROUTES (goal 0099): what the Quick
// Panel runs when the user accepts a validated reply. Routes are
// composition by contract -- seeded, user-editable workflows, never a
// bespoke service path -- so "same but different destination" is an
// edit here, not a kernel change.
const (
	// ReplyCardsWorkflowID is the create-cards route.
	ReplyCardsWorkflowID = "clipbridge-reply-cards-workflow"
	// ReplyNoteWorkflowID is the note-to-scratchpad route.
	ReplyNoteWorkflowID = "clipbridge-reply-note-workflow"
)

func builtInClipbridgeWorkflows() []Workflow {
	const (
		cardsTriggerID = "clipbridge-reply-cards-trigger"
		cardsApplyID   = "clipbridge-reply-cards-apply"
		noteTriggerID  = "clipbridge-reply-note-trigger"
		noteApplyID    = "clipbridge-reply-note-apply"
	)
	cardsNodes, err := ResolveNodeDefaults([]Node{
		{ID: cardsTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: cardsApplyID, NodeTypeID: "apply-atlas-from-reply", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"itemsAttribute": "items", "parentAttribute": "parentId", "outputAttribute": "created"}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}
	noteNodes, err := ResolveNodeDefaults([]Node{
		{ID: noteTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: noteApplyID, NodeTypeID: "apply-atlas-from-reply", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"itemsAttribute": "items", "outputAttribute": "created"}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return []Workflow{
		{
			ID:    ReplyCardsWorkflowID,
			Label: "Clipboard reply: create cards",
			Description: "Creates the Atlas cards a reviewed clipboard reply proposes, landing them in the " +
				"space you were viewing when you accepted. Runs from the Quick Panel or the AI companion " +
				"after you accept the preview -- the accepted items arrive in the \"items\" input. Edit " +
				"this workflow to change where accepted cards go or what happens after they land.",
			Nodes: cardsNodes,
			Attributes: []AttributeDef{
				{Key: "items", Label: "Accepted items (JSON)", Type: FieldText},
				{Key: "parentId", Label: "Landing space (card id, optional)", Type: FieldText},
			},
			Edges: []Edge{
				{ID: "clipbridge-reply-cards-e0", Source: cardsTriggerID, Target: cardsApplyID},
			},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(2),
		},
		{
			ID:    ReplyNoteWorkflowID,
			Label: "Clipboard reply: save to Scratchpad",
			Description: "Saves a reviewed clipboard reply's text into the Scratchpad as a note. Runs from " +
				"the Quick Panel after you accept the preview. Edit this workflow to route the note " +
				"somewhere else or add follow-up steps.",
			Nodes: noteNodes,
			Attributes: []AttributeDef{
				{Key: "items", Label: "Accepted items (JSON)", Type: FieldText},
			},
			Edges: []Edge{
				{ID: "clipbridge-reply-note-e0", Source: noteTriggerID, Target: noteApplyID},
			},
			BuiltIn: true,
			// Stamp(2): the shared apply-atlas-from-reply NodeType's new
			// parentAttribute ConfigField auto-fills onto this workflow's
			// node too (ResolveNodeDefaults), even though this route
			// never sets it -- a genuinely changed resolved shape, not
			// just the sibling cards route.
			Seed: seedorigin.Stamp(2),
		},
	}
}
