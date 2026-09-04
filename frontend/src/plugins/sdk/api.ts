// The one object a plugin ever holds: api, handed to its exported
// activate(api) and frozen. Everything a plugin can do -- render, read,
// write, ask -- is a call on this object; there is no other way for a
// plugin's code to reach outside its own module.

import type { CanvasObjectDecl } from './canvasObjects'
import type { GuardedActionResult } from './guardedAction'
import type { PluginCommandDecl } from './commands'
import type { PluginSettingsAPI } from './settings'
import type { PluginNoticeInput } from './notify'
import type { PluginStorageAPI } from './storage'
import type { ContentQuery, ContentEntry, PluginEventMap, PluginFetchInit, PluginFetchResult, PluginContentAPI, PluginFilesAPI, PluginConvertAPI } from './content'
import type { PluginViewDecl } from './views'
import type { PluginCaptureDecl } from './captures'

export interface MillPluginAPI {
  millVersion: string
  pluginId: string
  registerCanvasObject: (decl: CanvasObjectDecl) => void
  registerCommand: (decl: PluginCommandDecl) => void
  /** Asks Mill to perform an action the plugin cannot perform itself.
   * See CanvasObjectFaceCtx's own requestGuardedAction for the full
   * contract — this is the same door, callable outside a face. */
  requestGuardedAction: (kind: string, attributes: Record<string, string>, description: string) => Promise<GuardedActionResult>
  settings: PluginSettingsAPI
  /** Shows a notice and returns its dismiss function. */
  notify: (input: PluginNoticeInput) => () => void
  storage: PluginStorageAPI
  /** Lists the board's contents — always the current state, never a
   * cache. */
  query: (q?: ContentQuery) => Promise<ContentEntry[]>
  /** Subscribes to a host event and returns the unsubscribe function. */
  on: <K extends keyof PluginEventMap>(event: K, handler: (payload: PluginEventMap[K]) => void) => () => void
  /** Performs a guarded HTTP request; see PluginFetchInit for the full
   * contract. */
  fetch: (url: string, init?: PluginFetchInit) => Promise<PluginFetchResult>
  content: PluginContentAPI
  convert: PluginConvertAPI
  files: PluginFilesAPI
  registerView: (decl: PluginViewDecl) => void
  registerCapture: (decl: PluginCaptureDecl) => void
}

/** A plugin's main.js default-exports (or named-exports) activate:
 * export function activate(api) { api.registerCanvasObject({...}) } */
export interface PluginModule {
  activate?: (api: MillPluginAPI) => void | Promise<void>
  default?: { activate?: (api: MillPluginAPI) => void | Promise<void> } | ((api: MillPluginAPI) => void | Promise<void>)
}
