package composition

import "github.com/alicoding/mill/internal/domain/seedorigin"

// atlasIntakeKindID/atlasRelatesToLinkKindID are literal copies of
// internal/domain/atlas's own kindIntakeID/linkKindRelatesToID seed
// constants. A literal copy, not a shared import, because atlas already
// imports this package (atlas/builtin.go's own ExampleChildWorkflowID
// reference) -- composition importing atlas back would cycle. Both
// values are permanent seed IDs (docs/goals/0037's reconcile discipline
// keys a seed by ID forever), and
// internal/services/triggersvc/atlascard_seed_test.go cross-checks both
// literals against the real atlas.BuiltInKinds()/BuiltInLinkKinds()
// data, so a drift here fails loudly rather than silently.
const (
	atlasIntakeKindID        = "atlas-kind-intake"
	atlasRelatesToLinkKindID = "atlas-linkkind-relates-to"
)

// builtInAtlasCardWorkflows returns the seeded proof for goal 0066's
// Atlas<->Workflows integration: a kind-scoped trigger reacting to a
// card of its own making (the cycle-guard proof), plus a manual example
// exercising create/find/link. Split out of builtinworkflows.go once
// BuiltInWorkflows() crossed the 500-line convention, same split-file
// reasoning every other builtinworkflows_*.go file already follows.
func builtInAtlasCardWorkflows() []Workflow {
	const (
		intakeTriggerID = "example-card-intake-trigger"
		intakeUpdateID  = "example-card-intake-update"
	)
	intakeNodes, err := ResolveNodeDefaults([]Node{
		{ID: intakeTriggerID, NodeTypeID: "trigger-atlas-card", Position: Position{X: 0, Y: 0},
			Config: map[string]string{"kindId": atlasIntakeKindID}},
		{ID: intakeUpdateID, NodeTypeID: "apply-atlas-card-update", Position: Position{X: 0, Y: 100},
			Config: map[string]string{
				"kindId": atlasIntakeKindID, "cardId": "attr:cardId",
				"fieldBindings": `{"status":"Processed"}`,
			}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	const (
		createTriggerID = "example-card-create-trigger"
		createFirstID   = "example-card-create-first"
		createSecondID  = "example-card-create-second"
		createFindID    = "example-card-create-find"
		createLinkID    = "example-card-create-link"
	)
	createNodes, err := ResolveNodeDefaults([]Node{
		{ID: createTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: createFirstID, NodeTypeID: "apply-atlas-card-create", Position: Position{X: 0, Y: 100},
			Config: map[string]string{
				"kindId": atlasIntakeKindID, "title": "Lead: Acme Co",
				"fieldBindings": `{"status":"New"}`, "outputAttribute": "leadCardId",
			}},
		{ID: createSecondID, NodeTypeID: "apply-atlas-card-create", Position: Position{X: 0, Y: 200},
			Config: map[string]string{
				"kindId": atlasIntakeKindID, "title": "Lead: Globex",
				"fieldBindings": `{"status":"New"}`, "outputAttribute": "secondCardId",
			}},
		{ID: createFindID, NodeTypeID: "process-atlas-card-find", Position: Position{X: 0, Y: 300},
			Config: map[string]string{
				"kindId":          atlasIntakeKindID,
				"matchParams":     `[{"column":"status","value":"New","matchType":"exact"}]`,
				"outputAttribute": "openLeads",
			}},
		{ID: createLinkID, NodeTypeID: "apply-atlas-card-link", Position: Position{X: 0, Y: 400},
			Config: map[string]string{
				"fromCardId": "attr:leadCardId", "toCardId": "attr:secondCardId",
				"linkKindId": atlasRelatesToLinkKindID, "label": "related lead",
			}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return []Workflow{
		{
			ID:    "example-card-intake-workflow",
			Label: "Example: Card intake",
			Description: "Fires whenever an Intake card is created or updated in Atlas, then stamps that " +
				"same card's status to \"Processed\" -- the round trip proving trigger-atlas-card, " +
				"apply-atlas-card-update, and the cycle guard together: this update writes to the exact " +
				"card that started the run, and does not re-fire itself.",
			Nodes: intakeNodes,
			Attributes: []AttributeDef{
				{Key: "cardId", Label: "Card ID", Type: FieldText},
				{Key: "kindId", Label: "Kind ID", Type: FieldText},
				{Key: "cardTitle", Label: "Card title", Type: FieldText},
				{Key: "changeType", Label: "Change type", Type: FieldText},
			},
			Edges: []Edge{
				{ID: "example-card-intake-e0", Source: intakeTriggerID, Target: intakeUpdateID},
			},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(1),
		},
		{
			ID:    "example-card-create-link-workflow",
			Label: "Example: Create and link Atlas cards",
			Description: "Creates two Intake cards, finds every open (\"New\") Intake card, then links the " +
				"two new cards together -- one run through apply-atlas-card-create, process-atlas-card-find, " +
				"and apply-atlas-card-link. Manual-triggered: running it again creates two more cards, same " +
				"as any other example that writes real data.",
			Nodes: createNodes,
			Edges: []Edge{
				{ID: "example-card-create-e0", Source: createTriggerID, Target: createFirstID},
				{ID: "example-card-create-e1", Source: createFirstID, Target: createSecondID},
				{ID: "example-card-create-e2", Source: createSecondID, Target: createFindID},
				{ID: "example-card-create-e3", Source: createFindID, Target: createLinkID},
			},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(1),
		},
	}
}
