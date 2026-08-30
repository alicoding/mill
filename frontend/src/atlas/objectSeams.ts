import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { isExtensionEnabled } from '../shared/extensionEnablementStore'
import { openAtlasEditDiagram } from './atlasEditDiagramStore'

// ADR-0046's two genuinely new seams (goal 0244 S0): a canvas-object
// noun DECLARES where its artifact lives (ObjectSource) and which door
// edits it (EditRoute); this file is the ONE place that reads those
// declarations and acts. An extension component calls dispatchObjectEdit
// -- it never calls AtlasService or the editor store itself (ADR-0046:
// "an extension invoking an editor itself -- it only declares; the host
// invokes").

// ObjectSource -- names the BoardObject.Payload key that carries a
// Kind's real artifact/reference, replacing per-reader Payload
// string-sniffing (the map that found this contract implicit: mirrorPath
// for a file, listID for a Configure List projection). pathKey/refKey
// ARE the literal Payload key -- resolveObjectSourceKey below is the one
// place that turns the declaration into the actual value. `url` names a Kind whose
// artifact is a web reference the Payload carries (docs/goals/0249's
// bookmark object is its first declarer); `bundled` stays a future
// engine-source arm (ADR-0045 S2), named in the ADR's glossary but not
// yet a member any registered noun declares. `board-local` (ADR-0046, goal 0244 S1) names
// a Kind whose Payload IS the artifact -- no external file/provider/url
// to resolve at all (shape's own geometry).
export type ObjectSource =
  | { kind: 'file'; pathKey: 'mirrorPath' }
  | { kind: 'provider'; refKey: 'listID' }
  | { kind: 'url'; urlKey: 'url' }
  | { kind: 'board-local' }

// EditRoute -- which door a Kind's edit affordance opens. The noun
// states it; dispatchObjectEdit is the one place that acts on it.
// 'inline' (table's own cell-edit, goal 0244 S2; a future sticky jot)
// names a Kind whose own content component owns the edit interaction
// directly INSIDE the well -- there is no separate door for the host to
// open, so dispatchObjectEdit's 'inline' arm stays a no-op by design
// (mirrored by AtlasBoardObjectNode.tsx's own editable gate, which never
// fires a double-click dispatch for it either).
export type EditRoute =
  | { kind: 'external-app' }
  | { kind: 'embedded-engine'; engine: 'drawio' }
  | { kind: 'inline' }
  | { kind: 'none' }

// EditRouteDecl -- a noun's own declared editRoute: either one static
// route (every Kind but diagram) or a per-object RESOLVER for a Kind
// whose door genuinely differs by its own artifact -- diagram opens the
// embedded drawio engine for a .drawio mirror but has no embeddable
// editor for a .mmd one (ADR-0045), so a single static route can't
// express it. resolveEditRoute is the ONE place that normalizes either
// shape into a concrete EditRoute; every reader (dispatchObjectEdit, the
// host's own double-click gate) goes through it rather than
// re-deriving the per-object check itself.
export type EditRouteDecl = EditRoute | ((object: BoardObject) => EditRoute)

export function resolveEditRoute(object: BoardObject, decl: EditRouteDecl): EditRoute {
  return typeof decl === 'function' ? decl(object) : decl
}

// resolveObjectSourceKey -- reads the real Payload value an ObjectSource
// declaration names. The one place a source's pathKey/refKey actually
// gets looked up, rather than each reader inlining
// `Payload?.mirrorPath`/`Payload?.listID` itself. A board-local source
// has no external key to resolve -- its Payload IS the artifact, read
// directly by the Kind's own Component, never fetched by key here.
export function resolveObjectSourceKey(object: BoardObject, source: ObjectSource): string | undefined {
  if (source.kind === 'board-local') return undefined
  const key = source.kind === 'file' ? source.pathKey : source.kind === 'url' ? source.urlKey : source.refKey
  return object.Payload?.[key]
}

// dispatchObjectEdit -- the host's own edit dispatch (ADR-0046),
// normalizing a static-or-resolver EditRouteDecl before acting so every
// caller can hand it either shape unchanged. Returns a Promise so a
// caller can still attach its own .catch the same way a direct
// AtlasService call already did -- swapping in this indirection changes
// who places the call, never the error-handling contract at the call
// site.
export function dispatchObjectEdit(object: BoardObject, editRoute: EditRouteDecl): Promise<void> {
  const resolved = resolveEditRoute(object, editRoute)
  switch (resolved.kind) {
    case 'external-app':
      return AtlasService.OpenObjectMirrorInDefaultApp(object.ID)
    case 'embedded-engine':
      // Extensions section disable semantics, item 3 (Settings >
      // Extensions): a disabled extension's embedded-editor door goes
      // inert -- the object still renders (this function is never in
      // that path) and "Open in default app" (a separate menu item,
      // gated on fileBacked, not on this route) still works when that
      // route exists. Keyed by object.Kind rather than a tool id: this
      // Kind (diagram) has no creation-tray tool of its own to disable
      // (native file-drop only), so its own Kind string IS the id a
      // caller would disable.
      if (!isExtensionEnabled(object.Kind ?? '')) return Promise.resolve()
      openAtlasEditDiagram(object.ID)
      return Promise.resolve()
    case 'inline':
    case 'none':
      return Promise.resolve()
  }
}

// writeObjectMirror -- the content-plane WRITE door for an
// extension-rendered face (goal 0239 S2's sheet quick-edit): an
// extension component never imports AtlasService (the extensions/
// cruiser rule); a whole-file mirror write dispatches through this one
// seam, the same posture dispatchObjectEdit above holds for the edit
// doors.
export function writeObjectMirror(objectID: string, content: string): Promise<void> {
  return AtlasService.WriteObjectMirror(objectID, content)
}
