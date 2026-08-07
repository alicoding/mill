import type { DragEvent } from 'react'
import { Text, TreeView } from '@primer/react'
import type { NodeType } from '../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { KIND_ICON, KIND_ICON_BG, KIND_LABEL } from './nodeKind'
import styles from './CompositionCanvas.module.css'

interface NodePaletteProps {
  nodeTypes: NodeType[]
}

function onPaletteDragStart(event: DragEvent<HTMLLIElement>, nt: NodeType) {
  event.dataTransfer.setData('application/mill-node-type', nt.ID)
  event.dataTransfer.effectAllowed = 'move'
}

function kindIcon(kind: string) {
  const Icon = KIND_ICON[kind]
  return (
    <div className={styles.paletteItemIcon} style={{ background: KIND_ICON_BG[kind] ?? 'var(--bgColor-neutral-emphasis)' }}>
      {Icon ? <Icon size={14} fill="var(--fgColor-onEmphasis)" /> : null}
    </div>
  )
}

// The "Add steps" drag-source panel -- toggled open/closed from
// CompositionCanvas.tsx's toolbar. Self-contained: drag-start just writes
// the dragged node type's ID onto the DOM drag event, which
// CompositionCanvas's onCanvasDrop reads back out on drop, so this
// component needs no callback prop wired in from the parent.
//
// Grouped by Kind via TreeView rather than a flat list -- a flat .map()
// over node types stopped scanning well once the count grew past a
// handful (docs/SPEC.md §9.1, .claude/rules/frontend.md). TreeView.Item
// spreads its remaining props onto the rendered <li> (confirmed against
// @primer/react's compiled source), so draggable/onDragStart/data-testid
// carry over from the old per-item <div> unchanged -- only the container
// element changed, not the drag mechanism CompositionCanvas's drop
// handler and the e2e suite both depend on.
export function NodePalette({ nodeTypes }: NodePaletteProps) {
  const kinds = [...new Set(nodeTypes.map((nt) => nt.Kind))]
  const byKind = new Map(kinds.map((kind) => [kind, nodeTypes.filter((nt) => nt.Kind === kind)]))

  return (
    <div className={styles.palette} data-testid="palette-panel">
      <Text size="small" weight="semibold" className={styles.paletteHeading}>Add steps</Text>
      <TreeView aria-label="Add steps">
        {kinds.map((kind) => (
          <TreeView.Item key={kind} id={`palette-kind-${kind}`} defaultExpanded>
            <TreeView.LeadingVisual>{kindIcon(kind)}</TreeView.LeadingVisual>
            {KIND_LABEL[kind] ?? kind}
            <TreeView.SubTree>
              {byKind.get(kind)!.map((nt) => (
                <TreeView.Item
                  key={nt.ID}
                  id={`palette-item-${nt.ID}`}
                  className={styles.paletteItem}
                  draggable
                  onDragStart={(e) => onPaletteDragStart(e, nt)}
                  data-testid="palette-item"
                >
                  {nt.Label}
                </TreeView.Item>
              ))}
            </TreeView.SubTree>
          </TreeView.Item>
        ))}
      </TreeView>
    </div>
  )
}
