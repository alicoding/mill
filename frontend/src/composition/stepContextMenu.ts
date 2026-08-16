import type { TFunction } from 'i18next'
import type { ContextMenuItem } from '../shared/ContextMenu'

// The step node's right-click items (goal 0075), split from
// CompositionCanvas at the 500-line convention: Open details mirrors
// double-click; Delete step stays visible-but-disabled in view mode
// (the toolbar's own honesty) and real in edit mode.
export function buildStepContextMenuItems(
  t: TFunction<'composition'>,
  readOnly: boolean,
  nodeId: string,
  actions: { openDetails: () => void; removeNode: (id: string) => void },
): ContextMenuItem[] {
  return [
    { id: 'details', label: t('canvas.contextMenu.openDetails'), run: actions.openDetails },
    { id: 'd1', divider: true },
    { id: 'delete', label: t('canvas.contextMenu.deleteStep'), danger: true, disabled: readOnly, run: () => actions.removeNode(nodeId) },
  ]
}
