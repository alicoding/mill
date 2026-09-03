import type { PluginCaptureDecl } from './sdk'

// Plugin-owned capture faces (goal 0309): the render callbacks a plugin
// registered at activate(), keyed by plugin + capture id -- collected
// like pluginViews.ts, read by the capture window's shell.
export interface PluginCapture {
	pluginId: string
	pluginName: string
	captureId: string
	label: string
	render: PluginCaptureDecl['render']
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
