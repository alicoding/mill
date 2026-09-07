package pluginsvc

import "strconv"

// pluginActorAttributes stamps the plugin actor's identity onto a
// guarded action's Attributes (docs/goals/0357 S1b): plugin.id and
// plugin.builtin, so a rule can condition on WHO is asking, not only
// what kind of action it is. Returns a new map (never aliases extra)
// with plugin.id/plugin.builtin set LAST, so a plugin-supplied
// Attributes key of the same name can never spoof its own identity.
// The one call site every plugin-originated guarded action shares --
// GuardedAction.Attributes is map[string]string, so plugin.builtin
// carries "true"/"false", not a native bool.
func pluginActorAttributes(pluginID string, plugin PluginInfo, extra map[string]string) map[string]string {
	out := make(map[string]string, len(extra)+2)
	for k, v := range extra {
		out[k] = v
	}
	out["plugin.id"] = pluginID
	out["plugin.builtin"] = strconv.FormatBool(plugin.Builtin)
	return out
}
