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
		Description: "Fires on-demand when a user clicks Run/Test. No listener process.",
	}, nil)
	RegisterNodeType(NodeType{
		ID: "trigger-hotkey", Kind: KindTrigger,
		Label:       "Trigger: hotkey",
		Description: "Fires on a global keyboard shortcut, even when Mill isn't focused. Bound via TriggerService, not a config field here -- pressing the combo is better UX than typing it.",
	}, nil)
	RegisterNodeType(NodeType{
		ID: "trigger-schedule", Kind: KindTrigger,
		Label:       "Trigger: schedule",
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
		Description: "Fires whenever the clipboard's content changes.",
	}, nil)
	RegisterNodeType(NodeType{
		ID: "trigger-filesystem-watch", Kind: KindTrigger,
		Label:       "Trigger: filesystem change",
		Description: "Fires when a file or folder under the configured path is added, changed, or deleted.",
		ConfigFields: []ConfigField{
			{
				Key: "path", Label: "Path to watch",
				Description: "Absolute path to a file or directory.",
				Default:     "", Type: FieldText,
			},
		},
	}, nil)
}
