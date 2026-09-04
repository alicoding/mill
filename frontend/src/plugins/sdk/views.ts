// A view is a plugin-owned work tab: its own full tab in Mill's main
// window, for something bigger than fits on a canvas object's face.

import type { PluginTheme, PluginThemeSubscribe } from './theme'

export interface PluginViewCtx {
  pluginId: string
  viewId: string
  /** The appearance this view is rendering under. */
  theme: PluginTheme
  /** Subscribes to every later appearance change. */
  onThemeChange: PluginThemeSubscribe
}

/** id must match a view the manifest declares under contributes.views
 * (which carries the tab's title). render draws into an element sized
 * to the panel, plain DOM like a canvas object's face, and runs once
 * per mount -- the panel stays mounted while its tab is hidden, and
 * mounts again after a reload restores the tab. Opening the view is a
 * registry command, view.open.<plugin>.<id>, reachable from the
 * palette and callable from the plugin's own commands. */
export interface PluginViewDecl {
  id: string
  render: (el: HTMLElement, ctx: PluginViewCtx) => void
}
