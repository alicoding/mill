import type { TFunction } from 'i18next'
import type { ContextMenuItem } from '../shared/ContextMenu'

// The canvas pane's and a connection's right-click items (goal 0075),
// each a registry command over the point or connection the canvas
// names (goal 0346 slice B) -- shared/canvasCommands.ts owns what each
// does and when it applies (a delete is absent in view mode, never
// dimmed). The labels are the canvas's own wording for its surface;
// the command's label is the palette's.
export function buildPaneContextMenuItems(t: TFunction<'composition'>, pos: { x: number; y: number }): ContextMenuItem[] {
  const ctx = { kind: 'canvasElement' as const, pos }
  return [
    { id: 'add-step', label: t('canvas.contextMenu.addStep'), commandId: 'canvas.addStep', ctx },
    { id: 'add-note', label: t('canvasToolbar.addNoteAriaLabel'), commandId: 'canvas.addNote', ctx },
  ]
}

export function buildEdgeContextMenuItems(t: TFunction<'composition'>, edgeId: string): ContextMenuItem[] {
  const ctx = { kind: 'canvasElement' as const, edgeId }
  return [
    { id: 'select', label: t('canvas.contextMenu.selectConnection'), commandId: 'canvas.edge.select', ctx },
    { id: 'd1', divider: true },
    { id: 'delete', label: t('canvas.contextMenu.deleteConnection'), commandId: 'canvas.edge.delete', ctx, danger: true },
  ]
}
