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

// Which of the diagram-mirror extensions above actually has an
// EMBEDDED EDITOR engine registered (goal 0237 S1: drawio only --
// mermaid has no embeddable editor to mount, S0's honest finding, so a
// mermaid mirror stays previewable/live-watched/externally-openable
// without an in-Mill edit door). Kept separate from the broader set
// above rather than narrowing it, since every OTHER diagram-mirror
// capability still applies to a mermaid mirror.
const DRAWIO_EDITABLE_EXTENSIONS = new Set(['.drawio'])

export function isDrawioEditableExtension(path: string): boolean {
  return DRAWIO_EDITABLE_EXTENSIONS.has(extensionOf(path))
}
