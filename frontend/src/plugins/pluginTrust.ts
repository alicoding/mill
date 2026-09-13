// The run policy for a scanned plugin (ADR-0051 §4, slice 3), mirrored
// from the Go side's settingsTrust.mayRun so the loader and the paste
// chain agree: an administrator's allow-list, when set, blocks every
// non-built-in plugin not on it; a plugin the user turned off stays
// off (built-ins included -- the toggle is the user's); a non-built-in
// plugin never reviewed waits for the user to allow it. Built-ins skip
// the two trust gates, never the user's own switch.
// 'unsigned': an administrator pinned signing keys and this folder's
// signature did not verify. Package approval comes from the backend's
// one-revision ApprovalState verdict; the browser never reconstructs
// consent from separately-read settings.
// 'policy': the organisation's policy file refuses it (goal 0349 S6)
// -- judged first, because nothing the user can set on this Mac moves
// it; the reason rides PluginIntegrity.policyBlocked.
export type PluginRunState = 'run' | 'policy' | 'blocked' | 'disabled' | 'unsigned' | 'unallowed' | 'changed' | 'error'

export interface PluginRunPolicy {
	// undefined means the settings read failed. It is kept distinct from
	// an explicitly empty list so activation fails closed and visibly.
	disabled?: readonly string[]
	allowlist?: readonly string[]
}

export interface PluginIntegrity {
	signingPolicy: boolean
	signed: boolean
	// The policy's refusal sentence, '' when it allows the plugin.
	policyBlocked?: string
	approvalState?: string
}

export function pluginRunState(id: string, builtin: boolean, policy: PluginRunPolicy, integrity: PluginIntegrity = { signingPolicy: false, signed: false }): PluginRunState {
	const allowlist = policy.allowlist
	const disabled = policy.disabled
	if (!builtin && integrity.policyBlocked) return 'policy'
	if (!builtin) {
		if (allowlist === undefined) return 'error'
		if (allowlist.length > 0 && !allowlist.includes(id)) return 'blocked'
	}
	if (disabled === undefined) return 'error'
	if (disabled.includes(id)) return 'disabled'
	if (!builtin && integrity.signingPolicy && !integrity.signed) return 'unsigned'
	if (builtin) return 'run'
	switch (integrity.approvalState) {
		case 'allowed': return 'run'
		case 'unallowed': return 'unallowed'
		case 'changed': return 'changed'
		default: return 'error'
	}
}
