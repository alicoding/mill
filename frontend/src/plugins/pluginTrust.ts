// The run policy for a scanned plugin (ADR-0051 §4, slice 3), mirrored
// from the Go side's settingsTrust.mayRun so the loader and the paste
// chain agree: an administrator's allow-list, when set, blocks every
// non-built-in plugin not on it; a plugin the user turned off stays
// off (built-ins included -- the toggle is the user's); a non-built-in
// plugin never reviewed waits for the user to allow it. Built-ins skip
// the two trust gates, never the user's own switch.
export type PluginRunState = 'run' | 'blocked' | 'disabled' | 'unallowed'

export interface PluginRunPolicy {
	disabled: readonly string[]
	allowed: readonly string[]
	allowlist: readonly string[]
}

export function pluginRunState(id: string, builtin: boolean, policy: PluginRunPolicy): PluginRunState {
	if (!builtin && policy.allowlist.length > 0 && !policy.allowlist.includes(id)) return 'blocked'
	if (policy.disabled.includes(id)) return 'disabled'
	if (!builtin && !policy.allowed.includes(id)) return 'unallowed'
	return 'run'
}
