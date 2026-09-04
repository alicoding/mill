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
	render: PluginViewDecl['render']
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
