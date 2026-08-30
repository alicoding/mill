import type { ComponentType } from 'react'
import type { Icon } from '@primer/octicons-react'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { ListProjection } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import type { EditRouteDecl, ObjectSource } from './objectSeams'
import type { MirrorReadState } from './useAtlasObjectMirrorRead'
import type { AtlasNounGroup } from './atlasNounRegistry'
import { AtlasUnknownKindContent } from './AtlasUnknownKindContent'

// The board-object CONTENT registry -- split out of atlasNounRegistry.ts
// (architecture.md's 500-line file limit) as its own real seam: this
// file owns what a PLACED instance of a BoardObject.Kind renders and how
// Settings > Extensions describes a noun with no tray tool at all,
// while atlasNounRegistry.ts keeps the tray-tool registry itself
// (AtlasToolShape, registerNoun). Every symbol here is still reached
// through '../atlasNounRegistry' by every existing importer --
// atlasNounRegistry.ts re-exports this module in full, so this split
// is invisible to every consumer outside these two files.

// AtlasBoardObjectKind -- the persisted BoardObject.Kind values that
// route through the shared 'atlas-object' renderer. Deliberately NOT
// the same set as a tool's own id: the pencil tool's id is 'pencil'
// but its placed instance is Kind 'ink' (the Drawing plugin's own
// objectKind declaration names it), so content resolution below keys
// off THIS set, read from object.Kind, never off a tool id. 'shape'
// and 'ink' stay members even though their tools are plugin-registered
// now (goal 0252): they are persisted Kinds real boards carry.
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
  // extension (goal 0237 S3 rider): Settings > Extensions row metadata
  // for a NOUN WITH NO TRAY TOOL. A tool-bearing noun already carries
  // icon/label/description on its own AtlasToolShapeBase descriptor
  // (registerNoun, atlasNounRegistry.ts), so this stays undefined
  // there; a tool-less noun (diagram, sheet -- file-drop only, no
  // AtlasToolShape to declare these on) sets it directly in its own
  // registerBoardObjectContent call so the Extensions list can render
  // an honest row for it too, mirroring goal 0211's own description-
  // field precedent. Presence of this field is exactly how
  // toolLessNounExtensions() below finds a tool-less noun worth
  // listing.
  extension?: ExtensionRowMeta
}

// ExtensionRowMeta -- the fields ExtensionRow.tsx needs for a tool-less
// noun's own row that AtlasToolShapeBase would otherwise supply.
// disableScopeNote is REQUIRED (never optional): a tool-less noun has
// no tray button to hide, so its own disable toggle gates a narrower,
// noun-specific seam (file-drop routing, and for diagram the embedded-
// editor door) -- the row must always say so rather than silently
// implying the same tray-wide scope a tool row's toggle has.
export interface ExtensionRowMeta {
  icon: Icon
  label: string
  description: string
  disableScopeNote: string
  capabilities?: readonly string[]
  // group (goal 0237 S3's Extensions-list review rider): the same tray
  // cluster AtlasToolShapeBase.group declares, REQUIRED for the same
  // reason -- Settings > Extensions groups every row into one of three
  // sections regardless of whether it has a tray button, and a
  // tool-less noun that omitted this would silently vanish from every
  // section instead of landing in an honest one. Both of today's
  // tool-less nouns (diagram, sheet) are file-drop-only artifacts, the
  // same family Image's own 'file' group already names.
  group: AtlasNounGroup
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
export interface AtlasBoardObjectContent extends AtlasNounContent {
  dragBand: boolean
  fileBacked: boolean
}

const boardObjectContentRegistry = new Map<string, AtlasBoardObjectContent>()

// registerBoardObjectContent -- the honest home for a noun with no
// tray tool at all (diagram: file-drop only, goal 0179 S2). Called
// either directly by a tool-less noun's own registration file, or by
// registerNoun (atlasNounRegistry.ts) on behalf of a tool descriptor
// that declares `boardObjectKind`/`content`. Throws on a duplicate
// Kind so two sources can never silently overwrite each other's
// content.
export function registerBoardObjectContent(kind: string, content: AtlasBoardObjectContent): void {
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
  return boardObjectContentRegistry.get(kind)
}

// unknownKindContent -- the fallback record AtlasBoardObjectNode uses
// when boardObjectContentFor misses (docs/goals/0249's audit rider):
// a disabled/uninstalled plugin's objects, and an ingestion-claimed
// kind whose plugin never registered, must stay VISIBLE, selectable
// and deletable rather than rendering null. Board-local and inert:
// no file backing, no drag band (nothing to scrub), no edit route.
export const unknownKindContent: AtlasBoardObjectContent = {
  Component: AtlasUnknownKindContent,
  ariaLabelKey: 'unknownKind.aria',
  role: undefined,
  source: { kind: 'board-local' },
  editRoute: { kind: 'none' },
  dragBand: false,
  fileBacked: false,
}

// ToolLessNounExtension -- one entry of toolLessNounExtensions() below,
// with `extension` already narrowed to non-optional (the filter that
// builds this array is the one place that check happens, so every
// consumer downstream gets a guaranteed ExtensionRowMeta instead of
// re-checking for undefined itself).
export interface ToolLessNounExtension {
  kind: string
  content: AtlasBoardObjectContent
  extension: ExtensionRowMeta
}

// toolLessNounExtensions -- every registered noun with NO AtlasToolShape
// of its own (diagram, sheet: file-drop only) that has declared
// Extensions-row metadata, so Settings > Extensions (ExtensionsSection.tsx)
// can list it alongside every tray tool. A tool-bearing noun's content
// also lives in this same registry (registerNoun, atlasNounRegistry.ts,
// folds it in) but never sets `extension`, so it's excluded here -- it
// already gets its own row from ATLAS_TOOLS directly. Sorted by kind
// for a stable, deterministic row order independent of
// import.meta.glob's own alphabetical file-discovery order.
export function toolLessNounExtensions(): ToolLessNounExtension[] {
  const found: ToolLessNounExtension[] = []
  for (const [kind, content] of boardObjectContentRegistry.entries()) {
    if (content.extension) found.push({ kind, content, extension: content.extension })
  }
  return found.sort((a, b) => a.kind.localeCompare(b.kind))
}
