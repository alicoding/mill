// The plugin-facing surface (docs/goals/0249, docs/adr/0047): every
// type an out-of-tree plugin's own code sees. This module is the
// boundary the dependency-cruiser kernel-import rule guards -- it may
// import NOTHING from the kernel (no bindings, no services, no atlas
// internals), because its contents describe what a plugin receives,
// and a plugin receives capabilities only through the api object
// handed to activate(), never through an import.

// ObjectSource/EditRoute restated here as plain strings rather than
// imported from atlas/objectSeams.ts: the SDK's compile-time
// independence from the kernel is the point of this file, and the
// host's registration path (hostApi.ts) narrows/validates them against
// the kernel's own unions at registration time.
export interface CanvasObjectDecl {
  // kind is the persisted BoardObject.Kind and the tray/palette id --
  // lowercase slug, must be unique against built-ins and other
  // plugins.
  kind: string
  // label/description are user-facing (tray tooltip, the Extensions
  // row).
  label: string
  description?: string
  // icon is one emoji -- rendered in the tray and the palette.
  icon: string
  // Where the object's artifact lives (ADR-0046 vocabulary):
  // 'board-local' | 'url' | 'file'.
  source: 'board-local' | 'url' | 'file'
  // Which door edits it: 'inline' (the face itself is the editor) |
  // 'external-app' | 'none'.
  editRoute: 'inline' | 'external-app' | 'none'
  // Payload a fresh placement starts with.
  defaultPayload?: Record<string, string>
  // renderFace draws the object's board face into el (a host-owned
  // div, already sized to the object's box). Called on mount and again
  // whenever the object's data changes -- el's contents are the
  // plugin's own to manage between calls (checking ctx.object for
  // what changed). Framework-agnostic on purpose: plain DOM, no
  // renderer library coupling, no build step required of a plugin.
  renderFace: (el: HTMLElement, ctx: CanvasObjectFaceCtx) => void
}

export interface CanvasObjectFaceCtx {
  object: {
    ID: string
    Kind: string
    Payload: Record<string, string>
  }
  // updatePayload merges patch into this object's payload through the
  // host (an empty string deletes a key). The write persists, syncs,
  // and participates in undo like any built-in edit.
  updatePayload: (patch: Record<string, string>) => Promise<void>
  // requestGuardedAction asks Mill to perform an action the plugin
  // cannot perform itself. The action kind must be declared in the
  // plugin's manifest capabilities; each use is evaluated by the
  // owner's guardrail rules and may require live approval.
  requestGuardedAction: (kind: string, attributes: Record<string, string>, description: string) => Promise<GuardedActionResult>
}

export interface GuardedActionResult {
  approved: boolean
  effect: string
  ruleLabel: string
  performed: boolean
}

export interface PluginCommandDecl {
  id: string
  label: string
  run: () => void
}

// MillPluginAPI is the one object a plugin ever holds -- handed to its
// exported activate(api), frozen by the host.
export interface MillPluginAPI {
  millVersion: string
  pluginId: string
  registerCanvasObject: (decl: CanvasObjectDecl) => void
  registerCommand: (decl: PluginCommandDecl) => void
  requestGuardedAction: (kind: string, attributes: Record<string, string>, description: string) => Promise<GuardedActionResult>
}

// A plugin's main.js default-exports (or named-exports) activate:
//   export function activate(api) { api.registerCanvasObject({...}) }
export interface PluginModule {
  activate?: (api: MillPluginAPI) => void | Promise<void>
  default?: { activate?: (api: MillPluginAPI) => void | Promise<void> } | ((api: MillPluginAPI) => void | Promise<void>)
}
