package composition

// Trigger node types register their schema here, in this package --
// not in package main alongside their dispatch behavior, despite
// docs/adr/0006-extension-point-registration.md's original plan to
// colocate both halves in one file. Found by actually running this
// package's own tests in isolation, not assumed: BuiltInWorkflows()
// below references "trigger-manual" via ResolveNodeDefaults, which
// requires the registry to have it -- if trigger-manual's schema only
// registered from package main's init(), composition's own tests
// (which never import package main) would never see it registered,
// and BuiltInWorkflows() would panic. A domain package's own fixtures
// can't depend on the outer application registering something first;
// the dependency has to run the other way. Each trigger type's
// *dispatch* behavior (the live listener it starts) still registers
// separately from package main (triggermanual.go et al. there) via
// RegisterTrigger -- that part genuinely can't live here, it needs
// real *TriggerService state this package has no business knowing
// about (domain-purity rule, CLAUDE.md).
//
// SPEC.md §3.4: each concrete event source is its own NodeType under
// KindTrigger, matching how n8n/Zapier actually structure this
// (separate, distinctly-named node types, not one generic node with a
// Source dropdown). A workflow's root is expected to be one of these;
// linearOrder's existing "exactly one starting node" check already
// enforces that without needing Trigger-specific logic. ExecuteWorkflow
// skips Trigger nodes at run time -- they mark the entry point, they
// don't transform the payload, so exec is nil for all five, same as
// decision-route.
func init() {
	RegisterNodeType(NodeType{
		ID: "trigger-manual", Kind: KindTrigger,
		Label:       "Manual run",
		Output:      "empty payload — the run starts here",
		Description: "Fires on-demand when a user clicks Run/Test. No listener process.",
		Complexity:  ComplexityBasic,
		Consumes:    []PayloadKind{PayloadNone},
		Produces:    PayloadProduce{Kind: PayloadNone},
	}, nil)
	RegisterNodeType(NodeType{
		ID: "trigger-hotkey", Kind: KindTrigger,
		Label:       "Hotkey pressed",
		Output:      "empty payload — the run starts here",
		Description: "Fires on a global keyboard shortcut, even when Mill isn't focused. Bound via TriggerService, not a config field here -- pressing the combo is better UX than typing it.",
		Complexity:  ComplexityBasic,
		Consumes:    []PayloadKind{PayloadNone},
		Produces:    PayloadProduce{Kind: PayloadNone},
	}, nil)
	RegisterNodeType(NodeType{
		ID: "trigger-schedule", Kind: KindTrigger,
		Label:       "On a schedule",
		Output:      "empty payload — the run starts here",
		Description: "Fires on a cron schedule.",
		Complexity:  ComplexityBasic,
		Consumes:    []PayloadKind{PayloadNone},
		Produces:    PayloadProduce{Kind: PayloadNone},
		ConfigFields: []ConfigField{
			{
				Key: "cron", Label: "Cron expression",
				Description: "Standard 5-field cron expression (minute hour day month weekday).",
				Default:     "", Type: FieldText,
			},
		},
	}, nil)
	RegisterNodeType(NodeType{
		ID: "trigger-clipboard-watch", Kind: KindTrigger,
		Label:       "Clipboard changed",
		Output:      "the clipboard text that changed",
		Description: "Fires whenever the clipboard's content changes.",
		Complexity:  ComplexityBasic,
		Consumes:    []PayloadKind{PayloadNone},
		Produces:    PayloadProduce{Kind: PayloadText},
	}, nil)
	RegisterNodeType(NodeType{
		ID: "trigger-clipboard-change", Kind: KindTrigger,
		Label:       "Clipboard captured",
		Output:      "the clipboard text that changed, already screened for confidential content and Mill's own writes",
		Description: "Fires when you copy something new -- skips content marked confidential by the app you copied it from, and skips text Mill itself just wrote back to the clipboard.",
		Complexity:  ComplexityBasic,
		Consumes:    []PayloadKind{PayloadNone},
		Produces:    PayloadProduce{Kind: PayloadText},
	}, nil)
	RegisterNodeType(NodeType{
		ID: "trigger-filesystem-watch", Kind: KindTrigger,
		Label:       "File changed",
		Output:      "the changed file path",
		Description: "Fires when a file or folder under the configured path is added, changed, or deleted.",
		Complexity:  ComplexityBasic,
		Consumes:    []PayloadKind{PayloadNone},
		Produces:    PayloadProduce{Kind: PayloadText},
		ConfigFields: []ConfigField{
			{
				Key: "path", Label: "Path to watch",
				Description: "Absolute path to a file or directory.",
				Default:     "", Type: FieldText,
			},
			{
				Key: "pattern", Label: "Filename pattern (optional)",
				Description: "A glob like *.md or report-*.csv -- only files whose name matches fire the trigger. Leave empty to fire on any change.",
				Default:     "", Type: FieldText,
			},
		},
	}, nil)
	RegisterNodeType(NodeType{
		ID: "trigger-callable", Kind: KindTrigger,
		Label:       "Called by another workflow",
		Output:      "the caller's typed input",
		Description: "Fires only when another workflow invokes this one with its Child Workflow step -- never by an outside event. A workflow starting here declares itself callable: it appears in the Child Workflow step's picker and nowhere else.",
		Complexity:  ComplexityBasic,
		Consumes:    []PayloadKind{PayloadNone},
		Produces:    PayloadProduce{Kind: PayloadAny},
	}, nil)
	RegisterNodeType(NodeType{
		ID: "trigger-system-event", Kind: KindTrigger,
		Complexity: ComplexityBasic,
		Consumes:   []PayloadKind{PayloadNone},
		Produces:   PayloadProduce{Kind: PayloadJSON},
		Label:      "System event",
		Output: "JSON payload: {event, runId, workflowId, workflowLabel, nodeId?, timestamp, version?, channel?} -- " +
			"the run/decision that caused this event. nodeId is only set for decision-parked (the " +
			"parked step's ID); version/channel only for update-available.",
		Description: "Fires when Mill's own engine emits an internal event -- a run finishing, failing, or parking for approval -- so a workflow can react to the platform itself, like forwarding pending approvals to another device.",
		ConfigFields: []ConfigField{
			{
				Key: "event", Label: "Event",
				Description: "Which internal event fires this trigger. \"Decision parked\" fires when a guardrail ask or human-review checkpoint parks awaiting approval; the run events fire once a run reaches a terminal state; \"update-available\" fires when an update check finds a newer release on this install's channel.",
				Default:     "decision-parked", Type: FieldOptions,
				Options: []string{"decision-parked", "run-completed", "run-failed", "run-cancelled", "update-available"},
			},
			{
				Key: "workflowScope", Label: "Workflow scope",
				Description: "Fire for every workflow's matching event, or scope to one specific workflow. Empty means all workflows.",
				Default:     "", Type: FieldText, RefKind: "workflow-scope",
			},
		},
	}, nil)
	RegisterNodeType(NodeType{
		ID: "trigger-atlas-card", Kind: KindTrigger,
		Complexity: ComplexityBasic,
		Consumes:   []PayloadKind{PayloadNone},
		Produces:   PayloadProduce{Kind: PayloadText},
		Label:      "Atlas card changed",
		Output: "the changed card's id -- also seeds cardId/kindId/cardTitle/changeType as typed " +
			"Attributes when this workflow declares them",
		Description: "Fires when a card of the chosen kind is created or updated in Atlas. A run started by this trigger never re-fires itself from a write it makes to its own source card, so a workflow that both reacts to and updates a card can't loop.",
		ConfigFields: []ConfigField{
			{
				Key: "kindId", Label: "Kind", Type: FieldText, RefKind: "atlas-kind",
				Description: "Which Atlas card kind to watch. Fires only for cards of this kind.",
			},
		},
	}, nil)
}
