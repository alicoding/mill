import type { CanvasPreviewDecl, CanvasPreviewKind, CanvasToolDecl, CanvasToolPhase, CanvasToolPoint } from './sdk/canvasTools'
import type { CanvasStyleFieldDecl } from './sdk/canvasObjects'

// The wire contract between a framed tool and the host (docs/goals/
// 0380 Decision 2). Every message crossing the bridge is PARSED here
// before anything acts on it -- a frame is untrusted input, so a
// malformed message is refused by name with nothing changed, never
// coerced into a plausible shape.
//
// Parsing lives apart from both bridge halves so the same functions
// serve the host's routing table and its own unit tests, and so the
// frame runtime can stay a standalone bundle that shares only the
// message NAMES (plugin-frame/protocol.test.ts pins that half).

// CanvasProtocolError is the typed refusal: `field` names the part of
// the message that was wrong, so a plugin author reading the console
// sees which key to fix rather than "invalid message".
export class CanvasProtocolError extends Error {
  readonly field: string
  constructor(field: string, detail: string) {
    super(`${field} ${detail}`)
    this.name = 'CanvasProtocolError'
    this.field = field
  }
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/
const PREVIEW_KINDS: readonly CanvasPreviewKind[] = ['rect', 'ellipse', 'line', 'path', 'shapes']
const PHASES: readonly CanvasToolPhase[] = ['down', 'move', 'up', 'cancel', 'fade']
const CURSORS = ['crosshair', 'cell', 'copy', 'grab', 'default'] as const
const GROUPS = ['objects', 'media', 'annotate', 'embed'] as const
const SOURCES = ['board-local', 'url', 'file'] as const
const EDIT_ROUTES = ['inline', 'external-app', 'none'] as const

function obj(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new CanvasProtocolError(field, 'must be an object')
  return value as Record<string, unknown>
}

function str(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new CanvasProtocolError(field, 'must be a string')
  return value
}

function optStr(value: unknown, field: string): string | undefined {
  return value === undefined || value === null ? undefined : str(value, field)
}

function num(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new CanvasProtocolError(field, 'must be a finite number')
  return value
}

function bool(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') throw new CanvasProtocolError(field, 'must be true or false')
  return value
}

function oneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  const s = str(value, field)
  if (!allowed.includes(s as T)) throw new CanvasProtocolError(field, `must be one of ${allowed.join(', ')}`)
  return s as T
}

function optOneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T | undefined {
  return value === undefined || value === null ? undefined : oneOf(value, field, allowed)
}

function slug(value: unknown, field: string): string {
  const s = str(value, field)
  if (!SLUG.test(s)) throw new CanvasProtocolError(field, 'must be a lowercase slug')
  return s
}

// A payload is flat string data, exactly what a board object's own
// Payload is -- a nested object or a number would survive postMessage
// but never survive the round trip through storage, so it is refused
// where it is written rather than where it is read back wrong.
export function parseData(value: unknown, field: string): Record<string, string> {
  if (value === undefined || value === null) return {}
  const raw = obj(value, field)
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(raw)) out[key] = str(entry, `${field}.${key}`)
  return out
}

function point(value: unknown, field: string): { x: number; y: number } {
  const raw = obj(value, field)
  return { x: num(raw.x, `${field}.x`), y: num(raw.y, `${field}.y`) }
}

function optPoint(value: unknown, field: string): { x: number; y: number } | undefined {
  return value === undefined || value === null ? undefined : point(value, field)
}

function optSize(value: unknown, field: string): { w: number; h: number } | undefined {
  if (value === undefined || value === null) return undefined
  const raw = obj(value, field)
  return { w: num(raw.w, `${field}.w`), h: num(raw.h, `${field}.h`) }
}

// ---- register.tool ---------------------------------------------------

// CanvasToolDescriptor is register.tool's payload: the whole of a
// CanvasToolDecl minus its onPointer function, which stays inside the
// frame. Style fields cross as the SAME plain data the same-DOM
// declaration already uses, so canvasToolAdapter.ts's own
// adaptStyleFields serves both paths.
export interface CanvasToolDescriptor {
  kind: string
  objectKind?: string
  label: string
  description?: string
  icon: string
  cursor?: typeof CURSORS[number]
  shortcutKey?: string
  group?: typeof GROUPS[number]
  source?: typeof SOURCES[number]
  editRoute?: typeof EDIT_ROUTES[number]
  ephemeral: boolean
  sticky?: boolean
  lockable?: boolean
  dragBand?: boolean
  fadeMs?: number
  styleFields: CanvasStyleFieldDecl[]
  preview?: CanvasPreviewDecl
}

// toolWireDescriptor is what register.tool carries: the declaration
// minus its own handler, which cannot cross a postMessage and does not
// need to -- the host calls back over 'tool.pointer' instead. Shared
// by the frame runtime (which sends it) and the same-DOM registration
// door (which validates the identical shape), so one declaration
// cannot mean two things depending on where the plugin runs.
export function toolWireDescriptor(decl: CanvasToolDecl): Record<string, unknown> {
  return {
    kind: decl.kind,
    objectKind: decl.objectKind,
    label: decl.label,
    description: decl.description,
    icon: decl.icon,
    cursor: decl.cursor,
    shortcutKey: decl.shortcutKey,
    group: decl.group,
    source: decl.source,
    editRoute: decl.editRoute,
    ephemeral: !!decl.ephemeral,
    sticky: decl.sticky,
    lockable: decl.lockable,
    dragBand: decl.dragBand,
    fadeMs: decl.fadeMs,
    styleFields: decl.styleFields ? [...decl.styleFields] : [],
    preview: decl.preview,
  }
}

function parsePreview(value: unknown): CanvasPreviewDecl | undefined {
  if (value === undefined || value === null) return undefined
  const raw = obj(value, 'preview')
  return {
    kind: oneOf(raw.kind, 'preview.kind', PREVIEW_KINDS),
    from: str(raw.from, 'preview.from'),
    fill: optStr(raw.fill, 'preview.fill'),
    stroke: optStr(raw.stroke, 'preview.stroke'),
    strokeWidth: optStr(raw.strokeWidth, 'preview.strokeWidth'),
    opacity: optStr(raw.opacity, 'preview.opacity'),
  }
}

// Style fields cross unvalidated in SHAPE only -- canvasToolAdapter's
// own styleFieldError is the single validator for their contents, run
// by the caller with the plugin's id already in the message.
function parseStyleFields(value: unknown): CanvasStyleFieldDecl[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new CanvasProtocolError('styleFields', 'must be an array')
  return value.map((entry, i) => obj(entry, `styleFields[${i}]`) as unknown as CanvasStyleFieldDecl)
}

export function parseRegisterTool(value: unknown): CanvasToolDescriptor {
  const raw = obj(value, 'register.tool')
  const ephemeral = bool(raw.ephemeral, 'ephemeral') ?? false
  const shortcutKey = optStr(raw.shortcutKey, 'shortcutKey')
  if (shortcutKey !== undefined && !/^[A-Z]$/.test(shortcutKey)) throw new CanvasProtocolError('shortcutKey', 'must be a single A-Z letter')
  return {
    kind: slug(raw.kind, 'kind'),
    objectKind: raw.objectKind === undefined || raw.objectKind === null ? undefined : slug(raw.objectKind, 'objectKind'),
    label: str(raw.label, 'label'),
    description: optStr(raw.description, 'description'),
    icon: str(raw.icon, 'icon'),
    cursor: optOneOf(raw.cursor, 'cursor', CURSORS),
    shortcutKey,
    group: optOneOf(raw.group, 'group', GROUPS),
    source: optOneOf(raw.source, 'source', SOURCES),
    editRoute: optOneOf(raw.editRoute, 'editRoute', EDIT_ROUTES),
    ephemeral,
    sticky: bool(raw.sticky, 'sticky'),
    lockable: bool(raw.lockable, 'lockable'),
    dragBand: bool(raw.dragBand, 'dragBand'),
    fadeMs: raw.fadeMs === undefined || raw.fadeMs === null ? undefined : num(raw.fadeMs, 'fadeMs'),
    styleFields: parseStyleFields(raw.styleFields),
    preview: parsePreview(raw.preview),
  }
}

// ---- register.face -----------------------------------------------------

// RegisterFaceDescriptor is register.face's payload (docs/goals/0380
// S2): a framed TOOL's own runtime naming the entry page its CREATED
// objects render their face at, for an objectKind distinct from the
// tool's own registration kind -- buildThirdPartyNoun's face lookup is
// keyed by the tool's OWN kind slug, so a tool whose objectKind names a
// different persisted Kind has no manifest field to declare that
// kind's face at all. Carries no function, unlike renderFace: the
// entry page itself, not this descriptor, draws the face.
export interface RegisterFaceDescriptor {
  objectKind: string
  entry: string
}

export function parseRegisterFace(value: unknown): RegisterFaceDescriptor {
  const raw = obj(value, 'register.face')
  return { objectKind: slug(raw.objectKind, 'objectKind'), entry: str(raw.entry, 'entry') }
}

// ---- the object doors ------------------------------------------------

export interface ObjectCreateMessage { toolId: string; kind: string; at: { x: number; y: number }; size?: { w: number; h: number }; data: Record<string, string>; preview: Record<string, string> }
export interface ObjectPatchMessage { id: string; at?: { x: number; y: number }; size?: { w: number; h: number }; data?: Record<string, string>; preview?: Record<string, string> }
export interface ObjectCommitMessage { id: string; select: boolean }
export interface ObjectMeasureMessage { markup: string; maxWidth: number }

export function parseObjectCreate(value: unknown): ObjectCreateMessage {
  const raw = obj(value, 'object.create')
  return {
    toolId: slug(raw.toolId, 'toolId'),
    kind: slug(raw.kind, 'kind'),
    at: point(raw.at, 'at'),
    size: optSize(raw.size, 'size'),
    data: parseData(raw.data, 'data'),
    preview: parseData(raw.preview, 'preview'),
  }
}

export function parseObjectPatch(value: unknown): ObjectPatchMessage {
  const raw = obj(value, 'object.patch')
  return {
    id: str(raw.id, 'id'),
    at: optPoint(raw.at, 'at'),
    size: optSize(raw.size, 'size'),
    data: raw.data === undefined || raw.data === null ? undefined : parseData(raw.data, 'data'),
    preview: raw.preview === undefined || raw.preview === null ? undefined : parseData(raw.preview, 'preview'),
  }
}

export function parseObjectCommit(value: unknown): ObjectCommitMessage {
  const raw = obj(value, 'object.commit')
  return { id: str(raw.id, 'id'), select: bool(raw.select, 'select') ?? false }
}

export function parseObjectId(value: unknown, field: string): string {
  return str(obj(value, field).id, 'id')
}

// maxWidth is bounded: an off-screen measuring frame is a real layout,
// and an unbounded width would let a plugin ask the host to lay out an
// arbitrarily large document on the main thread.
export const MEASURE_MAX_WIDTH = 4096

export function parseObjectMeasure(value: unknown): ObjectMeasureMessage {
  const raw = obj(value, 'object.measure')
  const maxWidth = num(raw.maxWidth, 'maxWidth')
  if (maxWidth <= 0 || maxWidth > MEASURE_MAX_WIDTH) throw new CanvasProtocolError('maxWidth', `must be between 1 and ${MEASURE_MAX_WIDTH}`)
  return { markup: str(raw.markup, 'markup'), maxWidth }
}

export function parseErasePoint(value: unknown): { toolId: string; at: { x: number; y: number } } {
  const raw = obj(value, 'board.eraseAt')
  return { toolId: slug(raw.toolId, 'toolId'), at: point(raw.at, 'at') }
}

export function parseToolId(value: unknown, field: string): string {
  return slug(obj(value, field).toolId, 'toolId')
}

// ---- tool.pointer (host -> frame) ------------------------------------

export interface ToolPointerPayload {
  toolId: string
  phase: CanvasToolPhase
  point: CanvasToolPoint
  coalesced: CanvasToolPoint[]
  modifiers: { shift: boolean; alt: boolean; ctrl: boolean; meta: boolean }
  zoom: number
  // The tool's current style-picker values ride every pointer event:
  // they are host-owned state a framed tool cannot read for itself,
  // and a tool needs them at exactly the moments it is called.
  styleValues: Record<string, string | number>
  target?: string
}

// parseToolPointer is the FRAME's own half: the frame trusts the host
// no more than the host trusts it, so the same shape check runs on
// both sides of the wire (the frame runtime calls this through its own
// copy of the rules -- see plugin-frame/activation.ts).
export function parseToolPointer(value: unknown): ToolPointerPayload {
  const raw = obj(value, 'tool.pointer')
  const mods = obj(raw.modifiers, 'modifiers')
  return {
    toolId: slug(raw.toolId, 'toolId'),
    phase: oneOf(raw.phase, 'phase', PHASES),
    point: parseToolPoint(raw.point, 'point'),
    coalesced: Array.isArray(raw.coalesced) ? raw.coalesced.map((p, i) => parseToolPoint(p, `coalesced[${i}]`)) : [],
    modifiers: {
      shift: bool(mods.shift, 'modifiers.shift') ?? false,
      alt: bool(mods.alt, 'modifiers.alt') ?? false,
      ctrl: bool(mods.ctrl, 'modifiers.ctrl') ?? false,
      meta: bool(mods.meta, 'modifiers.meta') ?? false,
    },
    zoom: num(raw.zoom, 'zoom'),
    styleValues: parseStyleValues(raw.styleValues),
    target: optStr(raw.target, 'target'),
  }
}

function parseStyleValues(value: unknown): Record<string, string | number> {
  if (value === undefined || value === null) return {}
  const raw = obj(value, 'styleValues')
  const out: Record<string, string | number> = {}
  for (const [key, entry] of Object.entries(raw)) {
    if (typeof entry === 'string' || typeof entry === 'number') out[key] = entry
  }
  return out
}

function parseToolPoint(value: unknown, field: string): CanvasToolPoint {
  const raw = obj(value, field)
  return { x: num(raw.x, `${field}.x`), y: num(raw.y, `${field}.y`), t: num(raw.t, `${field}.t`) }
}
