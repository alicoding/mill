import { extensionOf } from './unitRegistry'

// Kept identical to atlas/mirror.go's diagramMirrorExtensions allow-list
// (goal 0194's live round-trip slice): the live-watch/re-pick
// eligibility set. Shared by the "Choose file" honest-state action's
// own client-side re-validation -- the native dialog's own extension
// filter is display-only on some platforms, the same caveat
// PickImageFile's own doc comment already carries for the image door.
const DIAGRAM_MIRROR_EXTENSIONS = new Set(['.drawio', '.mmd', '.mermaid'])

export function isDiagramMirrorExtension(path: string): boolean {
  return DIAGRAM_MIRROR_EXTENSIONS.has(extensionOf(path))
}
