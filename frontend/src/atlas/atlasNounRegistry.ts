import type { ComponentType } from 'react'
import type { Icon } from '@primer/octicons-react'
import { ATLAS_TOOL_IDENTITIES, type AtlasToolIdentity, type AtlasToolInteraction } from '../shared/atlasToolIdentity'
import type { AtlasStyleField } from './atlasStyleVocabulary'
import type { FrameBox } from './useAtlasDragFiling'

// The frontend twin of composition/registry.go's RegisterNodeType
// (ADR-0006, goal 0180 slice 1): each canvas noun's own fat descriptor
// (icon, style picker, commit path) lives in its own
// frontend/src/atlas/tools/<id>Tool.ts file and calls registerNoun()
// at module-eval time -- atlasTools.ts discovers every one of them via
// import.meta.glob(..., { eager: true }) rather than holding a literal
// array every noun is appended to.
export type { AtlasToolInteraction }

// Session-only cache seeding a newly created object's own style
// (colour/size, ...) -- never persisted document data.
export type AtlasToolStyleDefaults = Record<string, unknown>

// The React Flow node TYPE (atlasBoardNodeTypes.ts's own rfNodeTypes
// keys, restated as a literal union here rather than imported -- that
// file eagerly imports every node RENDERER component, and this
// registry must stay a light, dependency-free descriptor layer) that
// renders this noun's own placed instance -- null for a tool whose
// gesture never persists anything a node could render at all (eraser
// destroys state, laser is a local-only overlay). goal 0181 S3's own
// join key: the surface-conformance tests below use it to find which
// renderer source a `resizable: true` answer must hold true against.
export type AtlasBoardNodeType = 'atlas-note' | 'atlas-sticky' | 'atlas-group' | 'atlas-object' | null

interface AtlasToolShapeBase {
  icon: Icon
  label: string
  shortcutKey: string | null
  tray: 'quick' | 'palette'
  styleDefaults?: AtlasToolStyleDefaults
  // styleFields (goal 0209): this noun's own declared styleable
  // properties, drawn from atlasStyleVocabulary.ts's closed
  // property-type vocabulary -- REQUIRED (never optional), the same
  // honest-false/empty pattern lockable/resizable/dragBand below
  // establish. An empty array is the honest answer for a noun with no
  // style surface at all (every noun but shape/pencil this slice), not
  // an omission. AtlasCreationTray.tsx's own 'drag-to-draw' branch
  // renders AtlasStylePanel.tsx anchored to the tool's button whenever
  // this array is non-empty -- registry-driven, so a THIRD noun
  // gaining a style surface never needs a hardcoded branch naming it
  // by id (docs/goals/0211-extension-tiers.md's standing rule: no core
  // file enumerates which nouns are styleable).
  styleFields: readonly AtlasStyleField[]
  // goal 0181 S3's own three declarations, one per surface that shipped
  // half-wired without one -- REQUIRED (never optional) so a noun that
  // omits one fails to compile rather than half-existing. `false`/`null`
  // are legitimate, honest answers, never omissions.
  //
  // lockable: does re-clicking this tool's OWN already-armed tray
  // button lock it for deliberate repeated placement (the Excalidraw
  // convention, goal 0199) instead of disarming on the second click?
  // Only meaningful for an armable tool (AtlasArmableTool, atlasTools.ts);
  // a non-armable tool (table, image) still declares it -- always false,
  // since neither one's own arming state ever reads a lock flag at all
  // (they arm through a picker/popover, never the toggleArm state
  // machine `isLockableArmTool` below reads).
  lockable: boolean
  // resizable: can the user drag this noun's own placed instance to a
  // new size via the shared NodeResizer (goal 0193 -- no board object
  // was resizable until this existed anywhere)? A container that
  // auto-fits its own children (area) and a tool that never persists an
  // instance (eraser, laser) both legitimately declare false.
  resizable: boolean
  // boardNodeType: which shared React Flow node type renders this
  // noun's placed instance -- see AtlasBoardNodeType above for why this
  // exists.
  boardNodeType: AtlasBoardNodeType
  // dragBand (goal 0206): does this noun's own placed instance need the
  // shared 'atlas-object' renderer's chrome band as its drag surface? A
  // Kind's whole body already drags UNLESS its own content captures
  // pointer events (a table's grid, a diagram's vendored pan/zoom) --
  // rendering the band on a Kind that doesn't need it reads as floating
  // debris, not an affordance (the goal's own defect 2). Only meaningful
  // for a noun whose boardNodeType is 'atlas-object'; every other noun
  // still declares it -- always false, since it has no shared band to
  // opt into at all. diagram carries the same true answer as table but
  // has no tray descriptor of its own (drop-only, goal 0179 S2) -- it
  // can't declare this field and is exempted from this registry's own
  // conformance check the same way it already is for resizable/
  // boardNodeType above; AtlasBoardObjectNode.tsx's own dragBand
  // constant states its true answer directly, and atlas-diagram-object.spec.ts
  // proves it live since the static check can't reach it.
  dragBand: boolean
  // sticky (goal 0215 S2): does this tool stay armed after a completed
  // gesture (pencil/eraser/laser -- repeated strokes/passes are the
  // point), or disarm after one (area, and shape via its OWN lockable
  // flag)? REQUIRED for every tool, not just the five drag ones -- a
  // non-drag tool (card/note/table/image) declares false honestly,
  // since it never reads this at all (same pattern as dragBand above).
  // useAtlasToolGesture.ts's gestureDisarmFns reads this to decide
  // whether a gesture's own onEnd may call ctx.disarm/disarmUnlessLocked
  // at all -- a sticky tool gets no-ops for both, so it cannot disarm
  // itself even if its own onEnd tried.
  sticky: boolean
  // gesture (goal 0215 S2): the ONE seam a drag-shaped tool declares
  // instead of hand-rolling its own capture-phase pointer hook --
  // useAtlasToolGesture.ts is the sole engine that reads this, and the
  // sole site left calling preventDefault/stopPropagation for a canvas
  // tool. null for every tool whose interaction never drags (card/note/
  // table/image), never omitted.
  gesture: AtlasToolGesture | null
  // Each concrete tool's own commit signature differs (a card commits
  // kind+title, a table mints a backing List); this base only has to
  // accept every one of them for the registry's own element type to
  // work, never call through it generically.
  commit: (input: never) => unknown
}

// AtlasGesturePoint -- one accumulated point of an in-flight gesture,
// always carrying its own capture timestamp so an ephemeral tool
// (laser's fadeMs) can age individual points out independently; every
// other tool simply ignores `t`.
export interface AtlasGesturePoint { x: number; y: number; t: number }

// AtlasGestureCtx -- what a tool's own gesture.onPoint/onEnd may reach,
// assembled fresh each render by AtlasBoard.tsx and threaded through by
// the engine. Deliberately NOT the wrapper box or React Flow's own
// screenToFlowPosition internals beyond the function itself -- kept to
// exactly what the five hooks this contract replaces actually consumed
// (goal 0215 S2 design lock item 1).
export interface AtlasGestureCtx {
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number }
  parentID: string
  cardBoxes: FrameBox[]
  noteBoxes: { id: string; x: number; y: number; width: number; height: number }[]
  onDeleteSelection: (cardIDs: string[], noteIDs: string[]) => void
  openAreaPopover: (screenPos: { x: number; y: number }, flowPos: { x: number; y: number }, enclosedCardIDs: string[], enclosedNoteIDs: string[]) => void
  onShapeCreated: (objectID: string) => void
  // Real functions for a one-shot tool; no-ops for a sticky one (the
  // engine's own gestureDisarmFns enforces this, not each tool).
  disarm: () => void
  disarmUnlessLocked: () => void
  // Fresh per-gesture scratch space the engine allocates at pointerdown
  // and discards after onEnd -- eraser's own onPoint is the sole
  // consumer today; no other tool touches it.
  hitAccumulator: { cardIDs: Set<string>; noteIDs: Set<string> }
}

// AtlasToolGesture -- a drag-shaped tool's own pure behavior
// contribution. onEnd receives the FULL client-space point list
// unconditionally (even a below-threshold stray click) -- deciding
// whether that constitutes a real gesture (a distance threshold, a
// hit count, or nothing at all) is each tool's own call, matching how
// the five hooks this contract replaces each guarded their own commit
// differently (eraser's own guard is "did we hit anything", never a
// distance).
export interface AtlasToolGesture {
  onPoint?: (pt: AtlasGesturePoint, ctx: AtlasGestureCtx) => void
  onEnd: (points: AtlasGesturePoint[], ctx: AtlasGestureCtx) => void
  // Rendered generically by AtlasBoard.tsx in ONE overlay slot, wrapper-
  // spanning, fed the engine's own wrapper-local point accumulation.
  preview?: ComponentType<{ points: AtlasGesturePoint[]; now: number }>
  // Ephemeral tools (laser) never commit -- their accumulated points
  // fade out on their own timer instead of clearing at pointerup, the
  // one generic mechanism useAtlasToolGesture.ts owns for an
  // 'ephemeral-drag' tool so no tool needs its own rAF loop.
  fadeMs?: number
}

// AtlasToolShape: a discriminated union, one member per
// shared/atlasToolIdentity.ts entry, correlating id<->interaction the
// same way the pre-registry hand-written ATLAS_TOOLS tuple did --
// mapped MECHANICALLY over AtlasToolIdentity['id'] (never over a
// per-noun file list), so a consumer that narrows on `interaction`
// (AtlasCreationTray.tsx discriminates its drag-to-draw/pick-then-
// place/paste-or-drop tray branches) can still read a correlated,
// literal `id` back out afterwards. A plain `{ id: string; interaction:
// AtlasToolInteraction }` shape would satisfy every individual noun
// file fine but silently stop narrowing at every CONSUMER of the
// runtime ATLAS_TOOLS array -- the same "collapses to string, invisible
// until something misroutes" trap one level down (see atlasTools.ts's
// own header for the top-level version).
export type AtlasToolShape = {
  [ID in AtlasToolIdentity['id']]: AtlasToolShapeBase & {
    id: ID
    interaction: Extract<AtlasToolIdentity, { id: ID }>['interaction']
  }
}[AtlasToolIdentity['id']]

const registry = new Map<string, AtlasToolShape>()

// registerNoun -- called once, at module-eval time, from each noun's
// own tools/<id>Tool.ts. Throws on a duplicate id so two files can
// never silently overwrite each other's registration.
export function registerNoun(descriptor: AtlasToolShape): void {
  if (registry.has(descriptor.id)) {
    throw new Error(`atlas noun "${descriptor.id}" registered twice -- check frontend/src/atlas/tools/`)
  }
  registry.set(descriptor.id, descriptor)
}

// identityOf -- the one lookup every noun's own descriptor file uses to
// source its id/shortcutKey/label/interaction from
// shared/atlasToolIdentity.ts rather than restating them.
export function identityOf<ID extends AtlasToolIdentity['id']>(id: ID): Extract<AtlasToolIdentity, { id: ID }> {
  const found = ATLAS_TOOL_IDENTITIES.find((t): t is Extract<AtlasToolIdentity, { id: ID }> => t.id === id)
  if (!found) throw new Error(`no atlas tool identity registered for "${id}"`)
  return found
}

// The agreement check (goal 0180 S1's own conformance mechanism, and
// goal 0181's first concrete instance): every identity in
// shared/atlasToolIdentity.ts must have exactly one registered
// descriptor, and every registered descriptor must have a matching
// identity. Called from atlasTools.ts once every tools/*.ts module has
// been eagerly imported, so a noun that half-exists on either side
// fails at module-eval time (surfacing in every test/dev/build that
// imports atlasTools.ts) instead of silently misrouting at runtime.
export function assertRegistryAgreesWithIdentity(): void {
  const identityIDs = ATLAS_TOOL_IDENTITIES.map((i) => i.id)
  for (const id of identityIDs) {
    if (!registry.has(id)) {
      throw new Error(`atlas noun "${id}" has an identity (shared/atlasToolIdentity.ts) but no registered descriptor -- add frontend/src/atlas/tools/${id}Tool.ts calling registerNoun()`)
    }
  }
  for (const id of registry.keys()) {
    if (!identityIDs.includes(id as AtlasToolIdentity['id'])) {
      throw new Error(`atlas noun "${id}" registered a descriptor (frontend/src/atlas/tools/) but has no identity in shared/atlasToolIdentity.ts`)
    }
  }
}

// orderedRegisteredTools -- ATLAS_TOOLS' own tray render order comes
// from ATLAS_TOOL_IDENTITIES (declared once, in the order the tray
// renders), never from Map insertion order (which would follow
// import.meta.glob's own alphabetical file-path sort and silently
// reorder the tray the next time a noun's filename changes).
export function orderedRegisteredTools(): AtlasToolShape[] {
  return ATLAS_TOOL_IDENTITIES.map((i) => {
    const found = registry.get(i.id)
    if (!found) throw new Error(`atlas noun "${i.id}" missing its registered descriptor`)
    return found
  })
}
