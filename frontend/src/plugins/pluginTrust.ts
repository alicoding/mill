// The run policy for a scanned plugin (ADR-0051 §4, slice 3), mirrored
// from the Go side's settingsTrust.mayRun so the loader and the paste
// chain agree: an administrator's allow-list, when set, blocks every
// non-built-in plugin not on it; a plugin the user turned off stays
// off (built-ins included -- the toggle is the user's); a non-built-in
// plugin never reviewed waits for the user to allow it. Built-ins skip
// the two trust gates, never the user's own switch.
// 'unsigned': an administrator pinned signing keys and this folder's
// signature did not verify; 'changed': the folder's content hash no
// longer matches the one its consent covered (slice 5's lock) -- both
// stop the plugin until an administrator or the user acts.
// 'policy': the organisation's policy file refuses it (goal 0349 S6)
// -- judged first, because nothing the user can set on this Mac moves
// it; the reason rides PluginIntegrity.policyBlocked.
export type PluginRunState = 'run' | 'policy' | 'blocked' | 'disabled' | 'unsigned' | 'unallowed' | 'changed'

export interface PluginRunPolicy {
	disabled: readonly string[]
	allowed: readonly string[]
	allowlist: readonly string[]
	// lock maps a plugin id to the content hash its consent covered.
	lock: Readonly<Record<string, string>>
}

export interface PluginIntegrity {
	contentHash: string
	signingPolicy: boolean
	signed: boolean
	// The policy's refusal sentence, '' when it allows the plugin.
	policyBlocked?: string
}

export function pluginRunState(id: string, builtin: boolean, policy: PluginRunPolicy, integrity: PluginIntegrity = { contentHash: '', signingPolicy: false, signed: false }): PluginRunState {
	if (!builtin && integrity.policyBlocked) return 'policy'
	if (!builtin && policy.allowlist.length > 0 && !policy.allowlist.includes(id)) return 'blocked'
	if (policy.disabled.includes(id)) return 'disabled'
	if (!builtin && integrity.signingPolicy && !integrity.signed) return 'unsigned'
	if (!builtin && !policy.allowed.includes(id)) return 'unallowed'
	const locked = policy.lock[id]
	if (!builtin && locked && integrity.contentHash && locked !== integrity.contentHash) return 'changed'
	return 'run'
}
