import type { ComponentType } from 'react'
import type { Icon } from '@primer/octicons-react'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { ListProjection } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { ATLAS_TOOL_IDENTITIES, type AtlasToolIdentity, type AtlasToolInteraction } from '../shared/atlasToolIdentity'
import type { AtlasStyleField } from './atlasStyleVocabulary'
import type { FrameBox } from './useAtlasDragFiling'
import type { EditRouteDecl, ObjectSource } from './objectSeams'
import type { MirrorReadState } from './useAtlasObjectMirrorRead'

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

// AtlasBoardObjectKind -- the persisted BoardObject.Kind values that
// route through the shared 'atlas-object' renderer. Deliberately NOT
// the same set as a tool's own id: pencilTool's own id is 'pencil' but
// its placed instance is Kind 'ink' (its own commit call names it), so
// content resolution below keys off THIS set, read from object.Kind,
// never off a tool id.
export type AtlasBoardObjectKind = 'shape' | 'image' | 'ink' | 'table' | 'diagram' | 'sheet'

// AtlasNounContent -- a Kind's own placed-instance rendering (goal
// 0215 S3): the content component AtlasBoardObjectNode.tsx mounts, the
// locale key for its wrapper's aria-label, and whether that wrapper
// carries img semantics (false only for table -- its own grid holds
// real interactive descendants, which img's ARIA role forbids).
// mirrorVersion (goal 0232 S1's file-backed preview/open/watch
// contract) bumps once for every live disk-change AtlasBoardObjectNode
// observes on this object's own mirrored file -- required, not
// optional, so a fileBacked Component can react to it via a plain
// useEffect dependency without also having to declare its own
// useAtlasMirrorChanged subscription (AtlasBoardObjectNode is now the
// ONE place that subscribes, per Kind's own fileBacked declaration
// below). A Component whose Kind is fileBacked: false receives it too
// (it just never changes) rather than a second, optional prop shape.
export interface AtlasNounContent {
  // object/mirrorVersion stay required (every Kind receives them,
  // whether or not it reads them -- the existing "declare honestly even
  // when meaningless" convention this file already documents for
  // dragBand/resizable/etc). mirrorContent/fetchListProjection/
  // repickMirror (ADR-0046, goal 0244 S1b) are the kernel reads/writes
  // a fileBacked or provider-backed Kind's own Component needs, now
  // supplied by the host (AtlasBoardObjectNode.tsx) as props instead of
  // the Component importing AtlasService directly -- the import the
  // extensions/ cruiser rule forbids. Optional, unlike every other
  // field on this interface, for one reason: AtlasMirrorImageContent.test.tsx
  // (goal 0243's regression pin) constructs a registered Component
  // directly with no host at all, and omitting these three must still
  // resolve to each one's own honest "not loaded"/no-op state rather
  // than a compile error.
  Component: ComponentType<{
    object: BoardObject
    mirrorVersion: number
    mirrorContent?: MirrorReadState
    fetchListProjection?: (id: string) => Promise<ListProjection>
    repickMirror?: (path: string) => Promise<unknown>
  }>
  ariaLabelKey: string
  role: 'img' | undefined
  // source / editRoute (ADR-0046, goal 0244): the two seams this Kind
  // declares about its own artifact -- where it lives, and which door
  // edits it. Optional (unlike Component/ariaLabelKey/role above)
  // because a Kind with no external artifact at all (shape's own
  // Payload-only geometry) has no honest ObjectSource member to declare
  // yet, and a Kind not yet migrated onto the edit law has no EditRoute.
  // Deliberately nested inside this `content` shape rather than a new
  // top-level AtlasToolShapeBase field -- AtlasToolShapeBase's own field
  // SET is a separately frozen contract (atlasNounDeclarationFields.json's
  // exhaustiveness check).
  source?: ObjectSource
  // editRoute (ADR-0046, goal 0244 S1): a static route or a per-object
  // RESOLVER -- see EditRouteDecl's own header for why a single Kind
  // (diagram) needs the function form.
  editRoute?: EditRouteDecl
}

// AtlasBoardObjectContent -- AtlasNounContent plus the board-facts
// AtlasBoardObjectNode.tsx also resolves per Kind; kept as the
// registry's own stored shape so a lookup returns everything the
// renderer needs in one call. fileBacked (goal 0232 S1): does this
// Kind's own Payload.mirrorPath name a real external file this content
// previews -- the ONE flag that drives both the live-watch subscription
// above and the object.openInDefaultApp command's own honest
// enablement (useAtlasObjectMenu.ts), so a new file-backed family's
// entire platform-provided contract is this one boolean plus reading
// mirrorVersion, never its own watch/open wiring. ADR-0046 (goal 0244
// S0): for a Kind that declares `source`, fileBacked is DERIVED from it
// (`source.kind === 'file'`) by registerBoardObjectContent below rather
// than independently settable -- a Kind with no source still declares
// this field directly (shape/ink today), so the field itself stays
// required.
interface AtlasBoardObjectContent extends AtlasNounContent {
  dragBand: boolean
  fileBacked: boolean
}

const boardObjectContentRegistry = new Map<AtlasBoardObjectKind, AtlasBoardObjectContent>()

// registerBoardObjectContent -- the honest home for a noun with no
// tray tool at all (diagram: file-drop only, goal 0179 S2). Called
// either directly by a tool-less noun's own registration file, or by
// registerNoun below on behalf of a tool descriptor that declares
// `boardObjectKind`/`content`. Throws on a duplicate Kind so two
// sources can never silently overwrite each other's content.
export function registerBoardObjectContent(kind: AtlasBoardObjectKind, content: AtlasBoardObjectContent): void {
  if (boardObjectContentRegistry.has(kind)) {
    throw new Error(`atlas board-object kind "${kind}" already has a registered content renderer -- check frontend/src/atlas/tools/`)
  }
  // fileBacked derivation (ADR-0046, goal 0244 S0): once a Kind
  // declares `source`, that union is the single source of truth for
  // whether it is file-backed -- the caller's own literal fileBacked
  // value (still required by the type) is superseded here rather than
  // read back, so the two can never silently disagree.
  const resolved = content.source ? { ...content, fileBacked: content.source.kind === 'file' } : content
  boardObjectContentRegistry.set(kind, resolved)
}

// boardObjectContentFor -- the ONE lookup AtlasBoardObjectNode.tsx uses
// to resolve a placed object's own content/ariaLabel/role/dragBand,
// replacing its former per-Kind hand branch. Accepts a plain string
// (BoardObject.Kind is untyped on the wire) and returns undefined for
// an unregistered Kind rather than throwing, since a render path must
// stay recoverable even against bad/legacy data.
export function boardObjectContentFor(kind: string): AtlasBoardObjectContent | undefined {
  return boardObjectContentRegistry.get(kind as AtlasBoardObjectKind)
}

interface AtlasToolShapeBase {
  icon: Icon
  label: string
  shortcutKey: string | null
  tray: 'quick' | 'palette'
  // group (goal 0224's tray-restructure slice): which tray cluster this
  // noun's own button renders in -- 'knowledge' (Card/Note/Table/Area:
  // the things that manage/arrange knowledge, tray-primary and rendered
  // first), 'file' (Image and any future file-backed object that
  // primarily arrives by drop/import, kept reachable but ordered after
  // the primary cluster), or 'annotate' (the freehand-marking family --
  // Shape/Pencil/Eraser/Laser -- collapsed into one expandable group so
  // the tray doesn't read as a flat drawing-app toolbar). REQUIRED, the
  // same honest-declaration shape lockable/resizable/sticky already
  // establish, so a new tool declares its own cluster instead of
  // silently landing wherever an array happens to iterate to.
  // AtlasCreationTray.tsx's own TRAY_GROUP_ORDER renders every cluster
  // from this field -- reversible by editing one tool's declaration,
  // never a hand-enumerated JSX reshuffle.
  group: 'knowledge' | 'file' | 'annotate'
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
  // fileBacked (goal 0232 S1): does this noun's own placed instance
  // read Payload.mirrorPath as a real external file (image/ink/diagram/
  // sheet), or is its render entirely live Payload/List data with no
  // backing file at all (shape/table, and every noun with boardObjectKind
  // null)? REQUIRED for every tool, the same "declare honestly even
  // when meaningless" shape dragBand/resizable/lockable/sticky already
  // establish -- registerNoun below folds it into the registry's own
  // AtlasBoardObjectContent the same way it folds dragBand.
  fileBacked: boolean
  // boardObjectKind (goal 0215 S3): the persisted BoardObject.Kind this
  // tool's own placed instance carries, or null for a tool that never
  // routes through the shared 'atlas-object' renderer (card/note/area
  // persist as their own Kind-less node types; eraser/laser persist
  // nothing at all). Exists because a tool's own id is not always its
  // Kind (pencilTool's own commit above writes Kind 'ink') -- content
  // below resolves purely off this field, via registerBoardObjectContent,
  // never off id.
  boardObjectKind: AtlasBoardObjectKind | null
  // content (goal 0215 S3): this noun's own placed-instance content
  // contribution -- registerNoun below feeds it straight into
  // boardObjectContentFor's registry when boardObjectKind is non-null,
  // killing AtlasBoardObjectNode.tsx's former per-Kind hand branch.
  // null exactly when boardObjectKind is null, never omitted.
  content: AtlasNounContent | null
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
  // Every board-local object's (ink/shape/image/table/diagram) own
  // rendered flow-space box -- read off React Flow's own measured node
  // state (goal 0230), since a BoardObject's persisted Size stays null
  // until first resize and its rendered footprint is otherwise CSS-
  // intrinsic (atlasBuildBoardObjectNodes.ts's own header comment).
  objectBoxes: { id: string; x: number; y: number; width: number; height: number }[]
  onDeleteSelection: (cardIDs: string[], noteIDs: string[], objectIDs: string[]) => void
  openAreaPopover: (screenPos: { x: number; y: number }, flowPos: { x: number; y: number }, enclosedCardIDs: string[], enclosedNoteIDs: string[]) => void
  onShapeCreated: (objectID: string) => void
  // Real functions for a one-shot tool; no-ops for a sticky one (the
  // engine's own gestureDisarmFns enforces this, not each tool).
  disarm: () => void
  disarmUnlessLocked: () => void
  // Fresh per-gesture scratch space the engine allocates at pointerdown
  // and discards after onEnd -- eraser's own onPoint is the sole
  // consumer today; no other tool touches it.
  hitAccumulator: { cardIDs: Set<string>; noteIDs: Set<string>; objectIDs: Set<string> }
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
// never silently overwrite each other's registration. A descriptor
// that declares boardObjectKind also feeds its content contribution
// into registerBoardObjectContent here -- a tool-bearing noun's board
// rendering registers through the SAME door a tool-less noun
// (diagramNoun.ts) calls directly, never a second mechanism.
export function registerNoun(descriptor: AtlasToolShape): void {
  if (registry.has(descriptor.id)) {
    throw new Error(`atlas noun "${descriptor.id}" registered twice -- check frontend/src/atlas/tools/`)
  }
  registry.set(descriptor.id, descriptor)
  if (descriptor.boardObjectKind) {
    if (!descriptor.content) {
      throw new Error(`atlas noun "${descriptor.id}" declares boardObjectKind "${descriptor.boardObjectKind}" but content: null`)
    }
    registerBoardObjectContent(descriptor.boardObjectKind, { ...descriptor.content, dragBand: descriptor.dragBand, fileBacked: descriptor.fileBacked })
  }
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
