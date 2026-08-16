import type { TFunction } from 'i18next'
import type { ContextMenuItem } from '../shared/ContextMenu'

// The canvas pane's right-click items (goal 0075's audit G3), split
// from CompositionCanvas at the 500-line convention alongside
// stepContextMenu.ts: edit mode only -- view mode keeps the bare
// preventDefault CompositionCanvas.tsx already had (an empty menu is
// worse than none). Add step toggles the SAME palette-open state the
// toolbar's own sidebar button controls; Add note reuses the
// toolbar's addNoteNear, positioned at the right-click point instead
// of the viewport center.
export function buildPaneContextMenuItems(
  t: TFunction<'composition'>,
  actions: { toggleAddSteps: () => void; addNote: () => void },
): ContextMenuItem[] {
  return [
    { id: 'add-step', label: t('canvas.contextMenu.addStep'), run: actions.toggleAddSteps },
    { id: 'add-note', label: t('canvasToolbar.addNoteAriaLabel'), run: actions.addNote },
  ]
}

// The canvas edge's right-click items (goal 0075's audit G4): Select
// connection always surfaces the edge inspector (where Branch
// conditions already live); Delete connection stays visible-but-
// disabled in view mode, real in edit mode -- the same honesty
// buildStepContextMenuItems' own Delete step already applies.
export function buildEdgeContextMenuItems(
  t: TFunction<'composition'>,
  readOnly: boolean,
  edgeId: string,
  actions: { selectEdge: (id: string) => void; removeEdge: (id: string) => void },
): ContextMenuItem[] {
  return [
    { id: 'select', label: t('canvas.contextMenu.selectConnection'), run: () => actions.selectEdge(edgeId) },
    { id: 'd1', divider: true },
    { id: 'delete', label: t('canvas.contextMenu.deleteConnection'), danger: true, disabled: readOnly, run: () => actions.removeEdge(edgeId) },
  ]
}
