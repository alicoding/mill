import type { Manifest } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'

// The extension-interop registry (goal 0364): where every activated
// plugin's own export surface lands, and the one gate every reach
// into it passes through -- api.extensions.get(id), a declared
// dependency's exports only, never app.plugins[id]-style reach
// (Obsidian's confirmed anti-pattern, docs/goals/0364 Research II).
//
// A same-DOM plugin's returned object is captured AS IS (captureSameDom):
// same JS realm, nothing to serialize. A framed plugin's cannot cross
// the postMessage boundary as a live object, so its own activation
// script (public/plugin-frame/activation.js) splits it into plain
// `data` plus the allowlisted `methods` PRESENT on it, and
// captureFramed re-intersects `methods` against the manifest's own
// exports allowlist -- the frame's word is never the last one.

export interface CapturedExports {
	// Non-function own properties of the returned object -- never
	// gated (only a callable method is "reach" into the extension).
	data: Record<string, unknown>
	// Allowlisted (manifest exports ∩ present-on-the-object) method
	// names -- the only names callExportedMethod will invoke.
	methods: string[]
	framed: boolean
	// The live returned object, same-DOM only -- undefined when framed
	// (a framed plugin's object never leaves its own realm).
	live?: Record<string, unknown>
}

const registry = new Map<string, CapturedExports>()

// framedCallHandler is installed once by activation.ts (which owns the
// live activation-frame contexts this module must not import, to keep
// the loader's own IMPORT DISCIPLINE intact -- see loader.ts's own
// comment on why atlasTools.ts must never load early).
type FramedCallHandler = (id: string, method: string, args: unknown[]) => Promise<unknown>
let framedCallHandler: FramedCallHandler | null = null

export function setFramedExportCallHandler(handler: FramedCallHandler): void {
	framedCallHandler = handler
}

// captureSameDomExports records what a same-DOM activate() returned,
// gated to the manifest's own exports allowlist: a function-valued
// allowlisted key becomes a callable method, every OTHER own property
// becomes ungated data.
export function captureSameDomExports(id: string, allowlist: readonly string[], returned: unknown): void {
	const obj = returned && typeof returned === 'object' ? (returned as Record<string, unknown>) : {}
	const methods = allowlist.filter((name) => typeof obj[name] === 'function')
	const data: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(obj)) if (typeof value !== 'function') data[key] = value
	registry.set(id, { data, methods, framed: false, live: obj })
}

// captureFramedExports records what a framed activation reported at
// its own activation-done — the frame already split data/methods
// against ITS OWN copy of the allowlist (public/plugin-frame/
// activation.js); methods is re-intersected here so a tampered frame
// can never claim a method the manifest never allowlisted.
export function captureFramedExports(id: string, allowlist: readonly string[], data: Record<string, unknown> | undefined, presentMethods: readonly string[] | undefined): void {
	const methods = (presentMethods ?? []).filter((m) => allowlist.includes(m))
	registry.set(id, { data: data ?? {}, methods, framed: true })
}

// clearExports drops a plugin's captured exports — reload/teardown,
// so a stale export never survives past the activation it came from.
export function clearExports(id: string): void {
	registry.delete(id)
}

// buildLiveView turns one capture into the object api.extensions.get
// hands back: its data spread as-is, plus one async stub per
// allowlisted method — same shape whether the target is same-DOM or
// framed, so a caller never has to know which.
function buildLiveView(id: string, captured: CapturedExports): Record<string, unknown> {
	const view: Record<string, unknown> = { ...captured.data }
	for (const method of captured.methods) view[method] = (...args: unknown[]) => callExportedMethod(id, method, args)
	return view
}

// getExtensionExports is MillPluginAPI['extensions']['get']'s
// implementation: undefined for an id the CALLER's own manifest does
// not declare as a dependency (the caller-side gate — never reach an
// undeclared extension), and undefined again for a declared id that
// has not activated (unknown, disabled, or still loading).
export async function getExtensionExports(callerManifest: Manifest, id: string): Promise<Record<string, unknown> | undefined> {
	const declared = (callerManifest.dependencies ?? []).some((d) => d.id === id)
	if (!declared) return undefined
	const captured = registry.get(id)
	if (!captured) return undefined
	return buildLiveView(id, captured)
}

// toWireDescriptor turns api.extensions.get's live-stub view (real
// callable functions, safe only within this same JS realm) into the
// shape a 'extensions.get' bridge door can actually send across
// postMessage: plain data plus just the callable method NAMES — the
// calling frame's own SDK code wraps those names back into stubs that
// call 'extensions.call'. Used by both frame bridges
// (pluginActivationBridge.ts, pluginFrameBridge.ts) so the split lives
// in exactly one place.
export function toWireDescriptor(view: Record<string, unknown> | undefined): { data: Record<string, unknown>; methods: string[] } | undefined {
	if (!view) return undefined
	const data: Record<string, unknown> = {}
	const methods: string[] = []
	for (const [key, value] of Object.entries(view)) {
		if (typeof value === 'function') methods.push(key)
		else data[key] = value
	}
	return { data, methods }
}

// callExportedMethod is the one invoker every path funnels through —
// api.extensions.get's own stubs, and the wire doors 'extensions.get'/
// 'extensions.call' a framed caller reaches through the bridge. A
// same-DOM callee is called directly; a framed callee is reached
// through its own activation frame, command.run-style.
export async function callExportedMethod(id: string, method: string, args: unknown[]): Promise<unknown> {
	const captured = registry.get(id)
	if (!captured) throw new Error(`Extension ${id} is not running.`)
	if (!captured.methods.includes(method)) throw new Error(`Method ${method} is not exported by ${id}.`)
	if (!captured.framed) {
		const obj = captured.live ?? {}
		const fn = obj[method]
		if (typeof fn !== 'function') throw new Error(`Method ${method} is not exported by ${id}.`)
		return await Reflect.apply(fn as (...callArgs: unknown[]) => unknown, obj, args)
	}
	if (!framedCallHandler) throw new Error(`Extension ${id} is not running.`)
	return framedCallHandler(id, method, args)
}
