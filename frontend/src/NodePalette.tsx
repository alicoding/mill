import type { DragEvent } from 'react'
import { Stack, Text } from '@primer/react'
import type { NodeType } from '../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { KIND_ICON, KIND_ICON_BG, KIND_LABEL } from './nodeKind'
import styles from './CompositionCanvas.module.css'
import runbookStyles from './ListCard.module.css'

interface NodePaletteProps {
  nodeTypes: NodeType[]
}

function onPaletteDragStart(event: DragEvent<HTMLDivElement>, nt: NodeType) {
  event.dataTransfer.setData('application/mill-node-type', nt.ID)
  event.dataTransfer.effectAllowed = 'move'
}

// The "Add steps" drag-source panel -- toggled open/closed from
// CompositionCanvas.tsx's toolbar. Self-contained: drag-start just writes
// the dragged node type's ID onto the DOM drag event, which
// CompositionCanvas's onCanvasDrop reads back out on drop, so this
// component needs no callback prop wired in from the parent.
export function NodePalette({ nodeTypes }: NodePaletteProps) {
  return (
    <div className={styles.palette} data-testid="palette-panel">
      <Text size="small" weight="semibold" className={styles.paletteHeading}>Add steps</Text>
      <Stack direction="vertical" gap="condensed">
        {nodeTypes.map((nt) => (
          <div
            key={nt.ID}
            className={`${runbookStyles.card} ${styles.paletteItem}`}
            draggable
            onDragStart={(e) => onPaletteDragStart(e, nt)}
            data-testid="palette-item"
          >
            <Stack direction="horizontal" gap="condensed" align="center">
              <div className={styles.paletteItemIcon} style={{ background: KIND_ICON_BG[nt.Kind] ?? 'var(--bgColor-neutral-emphasis)' }}>
                {(() => {
                  const Icon = KIND_ICON[nt.Kind]
                  return Icon ? <Icon size={14} fill="var(--fgColor-onEmphasis)" /> : null
                })()}
              </div>
              <div className={styles.paletteItemText}>
                <Text size="small" className={styles.canvasNodeKind}>{KIND_LABEL[nt.Kind] ?? nt.Kind}</Text>
                <Text size="small" weight="semibold" className={styles.canvasNodeLabel} title={nt.Label}>{nt.Label}</Text>
              </div>
            </Stack>
          </div>
        ))}
      </Stack>
    </div>
  )
}
