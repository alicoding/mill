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
  // The authoring gesture (goal 0252 S1). 'arm-then-click' (the
  // default): the armed click places one object with defaultPayload.
  // 'drag-to-draw': the armed pointer drag feeds `gesture`, whose own
  // onEnd decides what to create. 'ephemeral-drag': the drag renders
  // only the live preview and never creates anything (a laser-pointer
  // shape) -- renderFace, source, and editRoute are unused there.
  interaction?: 'arm-then-click' | 'drag-to-draw' | 'ephemeral-drag'
  // Does the tool stay armed after a completed drag (repeated strokes
  // are the point), or disarm after one? Only meaningful for a drag
  // interaction; defaults to true there (the drawing-tool convention).
  sticky?: boolean
  // The tool's styleable properties, from Mill's closed style
  // vocabulary. Declaring any makes the style picker render next to
  // the armed tool automatically; current values arrive on the
  // gesture ctx keyed by each field's own `key`, starting at its
  // `default`.
  styleFields?: readonly CanvasStyleFieldDecl[]
  // The drag behavior for a 'drag-to-draw' / 'ephemeral-drag'
  // interaction. Required there, forbidden for 'arm-then-click'.
  gesture?: CanvasGestureDecl
  // renderFace draws the object's board face into el (a host-owned
  // div, already sized to the object's box). Called on mount and again
  // whenever the object's data changes -- el's contents are the
  // plugin's own to manage between calls (checking ctx.object for
  // what changed). Framework-agnostic on purpose: plain DOM, no
  // renderer library coupling, no build step required of a plugin.
  // Optional ONLY for 'ephemeral-drag' (nothing is ever placed).
  renderFace?: (el: HTMLElement, ctx: CanvasObjectFaceCtx) => void
}

// Mill's closed style vocabulary (the same shapes built-in tools
// declare) -- restated as plain data for the SDK's compile-time
// independence; the host validates and fills the panel's own
// accessibility/test plumbing at registration time. 'shape-kind' (an
// icon-button picker) is deliberately absent from the plugin surface
// for now: its options require icon components a no-build plugin
// can't supply.
export type CanvasStyleFieldDecl =
  | { type: 'color'; key: string; options: readonly string[]; default: string }
  | { type: 'color-or-none'; key: string; options: readonly string[] }
  | { type: 'stroke-width'; key: string; render?: 'line' | 'dot'; options: readonly number[]; default: number }

// One accumulated point of an in-flight drag, in wrapper-local client
// space, with its capture timestamp (an ephemeral tool ages points out
// by `t`; every other tool can ignore it).
export interface CanvasGesturePoint { x: number; y: number; t: number }

// What a gesture's own callbacks may reach -- deliberately narrow
// (docs/goals/0252 S1): the conversion into board space, the tool's
// own current style values, and the one creation door, scoped to this
// plugin's own kind. Kernel internals (other objects' boxes, deletion,
// selection) are not part of this surface.
export interface CanvasGestureCtx {
  // Converts a gesture point's client position into board (flow)
  // coordinates.
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number }
  // The tool's current style-picker values, keyed by style field
  // ('color' -> a hex string, 'stroke-width' -> a number under key
  // 'size'), falling back to styleDefaults.
  styleValues: Record<string, string | number>
  // Creates one instance of THIS plugin's object at a board position
  // -- files into the frame under the point, syncs, and participates
  // in undo exactly like a click placement.
  createObject: (payload: Record<string, string>, flowPos: { x: number; y: number }) => Promise<void>
}

export interface CanvasGestureDecl {
  // Called per accumulated point while the drag is live.
  onPoint?: (pt: CanvasGesturePoint, ctx: CanvasGestureCtx) => void
  // Called once at pointer-up with the FULL point list -- a stray
  // click included, so deciding what counts as a real gesture (a
  // distance threshold, a point count) is the plugin's own call.
  onEnd: (points: CanvasGesturePoint[], ctx: CanvasGestureCtx) => void
  // Draws the live in-drag preview into el (a host-owned overlay
  // element spanning the board) -- called on every point and, for an
  // ephemeral tool, on every fade frame. el's contents are the
  // plugin's own to manage between calls.
  renderPreview?: (el: HTMLElement, points: CanvasGesturePoint[], now: number) => void
  // Ephemeral tools: accumulated points age out over this many
  // milliseconds instead of clearing at pointer-up.
  fadeMs?: number
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
