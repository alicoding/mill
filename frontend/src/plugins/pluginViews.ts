import type { PluginViewDecl } from './sdk'

// Plugin-owned work tabs (docs/goals/0290): the render callbacks a
// plugin registered at activate(), keyed by plugin + view id, joined
// with the manifest's declared title. Collected here (not in the
// store) for the same boot-order reason pluginCommands.ts exists --
// activation runs before the app module graph evaluates, and the
// shell reads this registry when it renders a plugin-view tab.
export interface PluginView {
	pluginId: string
	pluginName: string
	viewId: string
	title: string
	/** The plugin's version, so the host busts a stale entry page. */
	version: string
	// entry (docs/goals/0349): the manifest declared an .html page, so
	// this view mounts in its own sandboxed frame and needs no render.
	// A view with neither has no way to draw and never reaches the host.
	entry?: string
	render?: PluginViewDecl['render']
	// The plugin's own inbound handler, attached by registerView, and
	// the sink the mounted frame installs -- the two halves of the
	// page <-> plugin relay.
	onMessage?: (msg: unknown) => void
	post?: (msg: unknown) => void
}

const views = new Map<string, PluginView>()

export function pluginViewKey(pluginId: string, viewId: string): string {
	return `${pluginId}/${viewId}`
}

export function collectPluginView(view: PluginView): void {
	const key = pluginViewKey(view.pluginId, view.viewId)
	if (views.has(key)) throw new Error(`plugin ${view.pluginId}: view "${view.viewId}" is already registered`)
	views.set(key, view)
}

// attachPluginViewMessages joins a plugin's inbound handler onto a view
// the manifest already declared with an entry page: the page mounts
// with no plugin code at all, and registerView is how the plugin opts
// into the two-way relay afterwards.
export function attachPluginViewMessages(pluginId: string, viewId: string, onMessage?: (msg: unknown) => void): void {
	const view = views.get(pluginViewKey(pluginId, viewId))
	if (view) view.onMessage = onMessage
}

// setPluginViewSink installs (or clears, on unmount) the function that
// delivers a plugin's postMessage into the mounted page.
export function setPluginViewSink(pluginId: string, viewId: string, post: ((msg: unknown) => void) | undefined): void {
	const view = views.get(pluginViewKey(pluginId, viewId))
	if (view) view.post = post
}

export function getPluginView(pluginId: string, viewId: string): PluginView | undefined {
	return views.get(pluginViewKey(pluginId, viewId))
}

// unregisterPluginViews drops one plugin's registered views ahead of
// its re-activation (goal 0319's per-plugin reload); an open tab
// re-renders from the fresh module's render.
export function unregisterPluginViews(pluginId: string): void {
	for (const [key, view] of views) {
		if (view.pluginId === pluginId) views.delete(key)
	}
}
