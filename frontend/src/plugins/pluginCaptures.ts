import type { PluginCaptureDecl } from './sdk'

// Plugin-owned capture faces (goal 0309): the render callbacks a plugin
// registered at activate(), keyed by plugin + capture id -- collected
// like pluginViews.ts, read by the capture window's shell.
export interface PluginCapture {
	pluginId: string
	pluginName: string
	captureId: string
	label: string
	/** The plugin's version, so the host busts a stale entry page. */
	version: string
	// entry (docs/goals/0349): the framed form, identical to a view's.
	entry?: string
	render?: PluginCaptureDecl['render']
	onMessage?: (msg: unknown) => void
	post?: (msg: unknown) => void
}

const captures = new Map<string, PluginCapture>()

export function pluginCaptureKey(pluginId: string, captureId: string): string {
	return `${pluginId}/${captureId}`
}

export function collectPluginCapture(capture: PluginCapture): void {
	const key = pluginCaptureKey(capture.pluginId, capture.captureId)
	if (captures.has(key)) throw new Error(`plugin ${capture.pluginId}: capture "${capture.captureId}" is already registered`)
	captures.set(key, capture)
}

export function getPluginCapture(pluginId: string, captureId: string): PluginCapture | undefined {
	return captures.get(pluginCaptureKey(pluginId, captureId))
}

// attachPluginCaptureMessages / setPluginCaptureSink -- the capture
// half of the page <-> plugin relay pluginViews.ts carries.
export function attachPluginCaptureMessages(pluginId: string, captureId: string, onMessage?: (msg: unknown) => void): void {
	const capture = captures.get(pluginCaptureKey(pluginId, captureId))
	if (capture) capture.onMessage = onMessage
}

export function setPluginCaptureSink(pluginId: string, captureId: string, post: ((msg: unknown) => void) | undefined): void {
	const capture = captures.get(pluginCaptureKey(pluginId, captureId))
	if (capture) capture.post = post
}

// unregisterPluginCaptures -- the capture half of the same per-plugin
// reload sweep pluginViews.ts carries (goal 0319).
export function unregisterPluginCaptures(pluginId: string): void {
	for (const [key, capture] of captures) {
		if (capture.pluginId === pluginId) captures.delete(key)
	}
}
