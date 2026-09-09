// A canvas TOOL is the sandboxed form of a canvas object's authoring
// gesture: the plugin declares what the tool is and what its drag
// writes, and Mill owns every pointer event, every pixel drawn and
// every write to the board. Nothing here hands the plugin a host
// element, so a plugin declaring only tools runs entirely inside its
// own frame.
//
// The shape is the converged one: a tool is a state machine Mill
// drives through pointer phases, and a shape is data plus a
// declaration of how it is drawn — the plugin never paints.

import type { CanvasEditRoute, CanvasObjectFaceCtx, CanvasStyleFieldDecl } from './canvasObjects'

/** The shapes Mill can draw for a tool's live preview, from the
 * in-progress object's own data. Geometry is board coordinates, so a
 * preview stays pinned to the board while it is being drawn. */
export type CanvasPreviewKind = 'rect' | 'ellipse' | 'line' | 'path' | 'shapes'

/** preview declares what Mill draws while the drag is live, instead of
 * mounting the object's face for every pointer move. `from` names the
 * data key carrying the geometry:
 * - 'rect'/'ellipse': "x,y,width,height"
 * - 'line': "x1,y1,x2,y2"
 * - 'path': an SVG path, the same `d` an <svg> takes
 * - 'shapes': a JSON list of CanvasPreviewShape, for a preview whose
 *   parts each carry their own paint (a trail whose points fade
 *   independently)
 * `fill`, `stroke`, `strokeWidth` and `opacity` each name a data key
 * carrying that paint value; a key you leave out is not painted, and
 * for 'shapes' each part carries its own instead. */
export interface CanvasPreviewDecl {
  kind: CanvasPreviewKind
  from: string
  fill?: string
  stroke?: string
  strokeWidth?: string
  opacity?: string
}

/** One part of a 'shapes' preview: its own primitive, geometry and
 * paint, in the same encodings the single-shape kinds use. */
export interface CanvasPreviewShape {
  kind: 'rect' | 'ellipse' | 'line' | 'path'
  geometry: string
  fill?: string
  stroke?: string
  strokeWidth?: string
  opacity?: string
}

/** The pointer phases Mill drives a tool through: 'down' opens the
 * gesture, 'move' arrives once per frame, 'up' ends it, and 'cancel'
 * abandons it (Escape, or the pointer leaving). 'fade' arrives once per
 * frame after 'up' for a tool declaring fadeMs, until its trail has
 * aged out. */
export type CanvasToolPhase = 'down' | 'move' | 'up' | 'cancel' | 'fade'

/** One pointer sample in board coordinates, with the moment it was
 * captured. */
export interface CanvasToolPoint { x: number; y: number; t: number }

/** What a tool's handler receives. `point` is the newest sample;
 * `coalesced` carries the samples Mill folded into the same frame,
 * oldest first, so a freehand stroke loses no detail. `zoom` is the
 * board's current scale — divide a screen-constant width by it to keep
 * a trail the same thickness at every zoom. */
export interface CanvasToolPointerEvent {
  phase: CanvasToolPhase
  point: CanvasToolPoint
  coalesced: CanvasToolPoint[]
  modifiers: { shift: boolean; alt: boolean; ctrl: boolean; meta: boolean }
  zoom: number
  /** The tool's current style-picker values, keyed by each declared
   * field's own `key`, falling back to that field's default. */
  styleValues: Record<string, string | number>
  /** The board object under the pointer, when there is one. */
  target?: string
}

/** The draft a tool is drawing. Every write is live and undoes as
 * nothing — only `commit` reaches the board, as one undo step.
 *
 * `data` is what a commit saves as the object's payload; `preview` is
 * drawing state Mill paints from and never saves. A preview
 * declaration reads across both, so a shape whose preview IS its own
 * geometry names payload keys and a stroke in progress names preview
 * ones. */
export interface CanvasDraft {
  id: string
  /** Merges data, position and size into the draft. Mill redraws the
   * preview from it. */
  patch: (patch: { data?: Record<string, string>; preview?: Record<string, string>; at?: { x: number; y: number }; size?: { w: number; h: number } }) => Promise<void>
  /** Places the draft on the board as one undoable step and resolves
   * with the new object's id, or null when nothing was placed. */
  commit: (opts?: { select?: boolean }) => Promise<string | null>
  /** Throws the draft away; the board is exactly as it was. */
  discard: () => Promise<void>
}

/** What a tool's own code may ask Mill to do. */
export interface CanvasToolCtx {
  /** The tool's current style-picker values, keyed by each declared
   * field's own `key`. */
  styleValues: Record<string, string | number>
  /** Starts a draft: nothing is on the board yet, and Mill draws the
   * declared preview from it until it is committed or discarded. */
  createDraft: (input: { data?: Record<string, string>; preview?: Record<string, string>; at: { x: number; y: number }; size?: { w: number; h: number } }) => Promise<CanvasDraft>
  /** Erases whatever board item sits under a board point, and commits
   * the whole pass as one undo step. Present only when the manifest
   * declares the "erase-board-items" capability. */
  eraseAt?: (at: { x: number; y: number }) => Promise<void>
  commitErase?: () => Promise<void>
}

/** A tool Mill drives. `preview` is what Mill draws mid-drag;
 * `onPointer` is called once per phase, once per frame. */
export interface CanvasToolDecl {
  /** kind is the tool's tray id and, unless objectKind says otherwise,
   * the kind every placed instance is stored under. */
  kind: string
  objectKind?: string
  label: string
  description?: string
  /** One emoji, or a name from Mill's glyph set. */
  icon: string
  /** The pointer shape while this tool is armed. */
  cursor?: 'crosshair' | 'cell' | 'copy' | 'grab' | 'default'
  /** A single A-Z key that arms the tool. */
  shortcutKey?: string
  group?: 'objects' | 'media' | 'annotate' | 'embed'
  /** Where a placed object's artifact lives. Ignored by an ephemeral
   * tool, which places nothing. */
  source?: 'board-local' | 'url' | 'file'
  editRoute?: CanvasEditRoute
  /** ephemeral: the drag draws a trail and places nothing (a laser
   * pointer, an eraser). */
  ephemeral?: boolean
  /** Whether the tool stays armed after a completed drag. */
  sticky?: boolean
  lockable?: boolean
  dragBand?: boolean
  /** For an ephemeral tool: points age out over this many
   * milliseconds instead of clearing at pointer-up. */
  fadeMs?: number
  styleFields?: readonly CanvasStyleFieldDecl[]
  preview?: CanvasPreviewDecl
  /** Context-menu items are declared in the manifest, not here:
   * `contributes.menus`'s `editor/context` entries seat a command on
   * this tool's objects, and each entry's own `when` clause decides
   * when it shows. */
  /** renderFace draws a placed object's board face, for an extension
   * that runs in Mill's own document. Leave it out and name an entry
   * page beside the kind in the manifest instead — the sandboxed form,
   * and the only one available to an extension that runs framed. */
  renderFace?: (el: HTMLElement, ctx: CanvasObjectFaceCtx) => void
  onPointer: (event: CanvasToolPointerEvent, ctx: CanvasToolCtx) => void | Promise<void>
}

/** The size some markup takes at a maximum width, measured by Mill off
 * the board at real pixel size — for a face whose own layout depends
 * on how big its content turned out. */
export interface CanvasMeasureResult { width: number; height: number }
