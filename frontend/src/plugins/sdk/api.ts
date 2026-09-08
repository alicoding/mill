// The one object a plugin ever holds: api, handed to its exported
// activate(api) and frozen. Everything a plugin can do -- render, read,
// write, ask -- is a call on this object; there is no other way for a
// plugin's code to reach outside its own module.

import type { CanvasObjectDecl } from './canvasObjects'
import type { GuardedActionEvaluation, GuardedActionResult } from './guardedAction'
import type { PluginCommandDecl } from './commands'
import type { PluginSettingsAPI } from './settings'
import type { PluginNoticeInput } from './notify'
import type { PluginStorageAPI } from './storage'
import type { ContentQuery, ContentEntry, KindInfo, PluginEventMap, PluginFetchInit, PluginFetchResult, PluginContentAPI, PluginFilesAPI, PluginConvertAPI } from './content'
import type { PluginViewDecl, PluginViewHandle } from './views'
import type { PluginCaptureDecl, PluginCaptureHandle } from './captures'
import type { PluginUIAPI } from './ui'

export interface MillPluginAPI {
  millVersion: string
  pluginId: string
  registerCanvasObject: (decl: CanvasObjectDecl) => void
  registerCommand: (decl: PluginCommandDecl) => void
  /** Asks Mill to perform an action the plugin cannot perform itself.
   * See CanvasObjectFaceCtx's own requestGuardedAction for the full
   * contract — this is the same door, callable outside a face. */
  requestGuardedAction: (kind: string, attributes: Record<string, string>, description: string) => Promise<GuardedActionResult>
  /** Read-only: what a kind/attributes pair would do right now, with
   * no side effect. Lets a view drive its own local state before
   * asking Mill to actually send — see PluginViewHost's own inline
   * confirmation banner for the kinds this powers. */
  evaluateGuardedAction: (kind: string, attributes: Record<string, string>) => Promise<GuardedActionEvaluation>
  /** Reads through a Configure Integration the user picked in this
   * plugin's own settings — never an arbitrary host. path/method name
   * one operation the Integration's own OpenAPI spec declares; values
   * fill that operation's declared fields. */
  callIntegration: (integrationId: string, path: string, method: string, values: Record<string, string>) => Promise<string>
  settings: PluginSettingsAPI
  /** Shows a notice and returns its dismiss function. */
  notify: (input: PluginNoticeInput) => () => void
  storage: PluginStorageAPI
  /** Lists the board's contents — always the current state, never a
   * cache. */
  query: (q?: ContentQuery) => Promise<ContentEntry[]>
  /** Lists the board's card kinds: the schema each card's own `fields`
   * values read against. */
  kinds: () => Promise<KindInfo[]>
  /** Opens one card the way a projection's own card click does: the
   * board view, with that card's page on top of it. */
  open: (cardId: string) => void
  /** Subscribes to a host event and returns the unsubscribe function.
   * filter narrows delivery: a 'contents:changed' filter { kinds }
   * delivers only changes of those kinds ('card' changes, say), so a
   * view re-querying on every change pays only for its own. */
  on: <K extends keyof PluginEventMap>(event: K, handler: (payload: PluginEventMap[K]) => void, filter?: { kinds?: string[] }) => () => void
  /** Performs a guarded HTTP request; see PluginFetchInit for the full
   * contract. */
  fetch: (url: string, init?: PluginFetchInit) => Promise<PluginFetchResult>
  content: PluginContentAPI
  convert: PluginConvertAPI
  files: PluginFilesAPI
  registerView: (decl: PluginViewDecl) => PluginViewHandle
  registerCapture: (decl: PluginCaptureDecl) => PluginCaptureHandle
  ui: PluginUIAPI
  extensions: PluginExtensionsAPI
}

/** A bounded, declared-dependency-only door onto another installed
 * extension's own activate() return value, gated by the callee's own
 * manifest `exports` allowlist. Never a live handle into another
 * extension's internals. */
export interface PluginExtensionsAPI {
  /** Resolves the declared dependency's export surface: its plain
   * (non-function) properties, plus one callable async function per
   * allowlisted method name — framed or not, calling one always
   * returns a Promise. Resolves to `undefined` when `id` is not in
   * THIS plugin's own manifest `dependencies`, or the dependency has
   * not activated (not installed, disabled, or still loading).
   * Calling a method the dependency does not list in its own manifest
   * `exports` rejects with "Method {m} is not exported by {id}." */
  get: (id: string) => Promise<Record<string, unknown> | undefined>
}

/** A plugin's activate() may return a plain object — its EXPORT
 * surface, captured by the loader and reachable by a declared
 * dependant through api.extensions.get(id). */
export type PluginExports = Record<string, unknown> | void

/** A plugin's main.js default-exports (or named-exports) activate:
 * export function activate(api) { api.registerCanvasObject({...}) } */
export interface PluginModule {
  activate?: (api: MillPluginAPI) => PluginExports | Promise<PluginExports>
  default?: { activate?: (api: MillPluginAPI) => PluginExports | Promise<PluginExports> } | ((api: MillPluginAPI) => PluginExports | Promise<PluginExports>)
}
