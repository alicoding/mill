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
		Label:       "Trigger: manual",
		Output:      "empty payload — the run starts here",
		Description: "Fires on-demand when a user clicks Run/Test. No listener process.",
	}, nil)
	RegisterNodeType(NodeType{
		ID: "trigger-hotkey", Kind: KindTrigger,
		Label:       "Trigger: hotkey",
		Output:      "empty payload — the run starts here",
		Description: "Fires on a global keyboard shortcut, even when Mill isn't focused. Bound via TriggerService, not a config field here -- pressing the combo is better UX than typing it.",
	}, nil)
	RegisterNodeType(NodeType{
		ID: "trigger-schedule", Kind: KindTrigger,
		Label:       "Trigger: schedule",
		Output:      "empty payload — the run starts here",
		Description: "Fires on a cron schedule.",
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
		Label:       "Trigger: clipboard change",
		Output:      "the clipboard text that changed",
		Description: "Fires whenever the clipboard's content changes.",
	}, nil)
	RegisterNodeType(NodeType{
		ID: "trigger-filesystem-watch", Kind: KindTrigger,
		Label:       "Trigger: filesystem change",
		Output:      "the changed file path",
		Description: "Fires when a file or folder under the configured path is added, changed, or deleted.",
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
		Label:       "Trigger: callable by another workflow",
		Output:      "the caller's typed input",
		Description: "Fires only when invoked as a child by another workflow's Child Workflow step (docs/adr/0010) -- never by a real external event, no listener process. Modeled on n8n's own \"Execute Workflow Trigger\": a workflow rooted in this trigger declares itself a valid child target, decoupled from whatever its trigger would otherwise be. The child-workflow picker only lists workflows rooted here -- one rooted in a real-event trigger (filesystem-watch, clipboard-watch, ...) can't be invoked this way, since a parent has no way to synthesize that event.",
	}, nil)
	RegisterNodeType(NodeType{
		ID: "trigger-system-event", Kind: KindTrigger,
		Label: "Trigger: system event",
		Output: "JSON payload: {event, runId, workflowId, workflowLabel, nodeId?, timestamp} -- " +
			"the run/decision that caused this event. nodeId is only set for decision-parked (the " +
			"parked step's ID); empty for run-completed/run-failed/run-cancelled.",
		Description: "Fires when Mill's own execution engine emits an internal event -- docs/adr/0035, SPEC.md §3.4's Group D unparked. Mill dogfoods its own trigger/composition surface for platform-internal behavior (the forward-pending-approvals example workflow is the first real user) instead of a bespoke Go code path per event. Loop rule (docs/adr/0035 item 4, n8n's Error-Trigger precedent): a run whose OWN root trigger is trigger-system-event never emits a system event of its own, regardless of kind -- a chain always bottoms out after one hop, so this trigger can never fire itself into a cycle.",
		ConfigFields: []ConfigField{
			{
				Key: "event", Label: "Event",
				Description: "Which internal event fires this trigger. \"Decision parked\" fires when a guardrail ask or human-review checkpoint parks awaiting approval; the other three fire once a run reaches a terminal state.",
				Default:     "decision-parked", Type: FieldOptions,
				Options: []string{"decision-parked", "run-completed", "run-failed", "run-cancelled"},
			},
			{
				Key: "workflowScope", Label: "Workflow scope",
				Description: "Fire for every workflow's matching event, or scope to one specific workflow. Empty means all workflows.",
				Default:     "", Type: FieldText, RefKind: "workflow-scope",
			},
		},
	}, nil)
}
