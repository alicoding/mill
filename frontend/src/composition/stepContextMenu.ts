import type { TFunction } from 'i18next'
import type { ContextMenuItem } from '../shared/ContextMenu'

// A step's right-click items (goal 0075): registry commands over the
// step the canvas names (goal 0346 slice B) -- shared/canvasCommands.ts
// decides that Delete step is absent in view mode.
export function buildStepContextMenuItems(t: TFunction<'composition'>, nodeId: string): ContextMenuItem[] {
  const ctx = { kind: 'canvasElement' as const, nodeId }
  return [
    { id: 'details', label: t('canvas.contextMenu.openDetails'), commandId: 'canvas.step.openDetails', ctx },
    { id: 'd1', divider: true },
    { id: 'delete', label: t('canvas.contextMenu.deleteStep'), commandId: 'canvas.step.delete', ctx, danger: true },
  ]
}
