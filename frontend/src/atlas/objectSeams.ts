import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
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
// place that turns the declaration into the actual value. `url` and
// `bundled` are the future self-hosted/vendored engine-source arms
// (ADR-0045 S2) -- named in the ADR's glossary but not yet a member any
// registered noun declares.
export type ObjectSource =
  | { kind: 'file'; pathKey: 'mirrorPath' }
  | { kind: 'provider'; refKey: 'listID' }

// EditRoute -- which door a Kind's edit affordance opens. The noun
// states it; dispatchObjectEdit is the one place that acts on it.
// 'inline' is a stub for a future cell-edit/short sticky jot
// (ADR-0046's edit law) -- no implementation lands under this arm yet.
export type EditRoute =
  | { kind: 'external-app' }
  | { kind: 'embedded-engine'; engine: 'drawio' }
  | { kind: 'inline' }
  | { kind: 'none' }

// resolveObjectSourceKey -- reads the real Payload value an ObjectSource
// declaration names. The one place a source's pathKey/refKey actually
// gets looked up, rather than each reader inlining
// `Payload?.mirrorPath`/`Payload?.listID` itself.
export function resolveObjectSourceKey(object: BoardObject, source: ObjectSource): string | undefined {
  const key = source.kind === 'file' ? source.pathKey : source.refKey
  return object.Payload?.[key]
}

// dispatchObjectEdit -- the host's own edit dispatch (ADR-0046). Returns
// a Promise so a caller can still attach its own .catch the same way a
// direct AtlasService call already did -- swapping in this indirection
// changes who places the call, never the error-handling contract at the
// call site.
export function dispatchObjectEdit(object: BoardObject, editRoute: EditRoute): Promise<void> {
  switch (editRoute.kind) {
    case 'external-app':
      return AtlasService.OpenObjectMirrorInDefaultApp(object.ID)
    case 'embedded-engine':
      openAtlasEditDiagram(object.ID)
      return Promise.resolve()
    case 'inline':
    case 'none':
      return Promise.resolve()
  }
}
