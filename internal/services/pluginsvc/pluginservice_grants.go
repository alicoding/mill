package pluginsvc

// pluginGrants computes PluginInfo.Grants for one scanned manifest
// (docs/goals/0375 S1b): what a plugin was given outside the sandboxed
// activation frame every other non-built-in plugin runs inside. A
// built-in never carries a grant -- it already runs same-DOM by its
// own named transition (PluginInfo.Builtin), not by anything a
// manifest asked for. Split from pluginservice.go at the hand-written-
// file line limit (.claude/rules/architecture.md).
func pluginGrants(builtin bool, m Manifest) []string {
	if builtin || len(m.Contributes.CanvasObjects) == 0 {
		return nil
	}
	return []string{"canvas-host"}
}
