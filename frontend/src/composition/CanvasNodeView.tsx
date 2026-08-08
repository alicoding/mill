import { Handle, Position as RFPosition } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { Text } from '@primer/react'
import type { CanvasNode } from './canvasStore'
import { KIND_ICON, KIND_ICON_BG, KIND_LABEL } from './nodeKind'
import styles from './CompositionCanvas.module.css'

// Top/bottom handles, not left/right -- a top-to-bottom chain with each
// edge entering/exiting a node's horizontal center (React Flow's default
// for Top/Bottom handle positions) reads as one orderly column instead
// of the diagonal, easy-to-overlap layout left/right handles produced.
// Every node renders at the same fixed width/height (CANVAS_NODE_WIDTH/
// HEIGHT, canvasConstants.ts -- shared with the elkjs layout call and
// canvasLayout.ts's collision math so everything agrees on the size a
// node actually renders at) regardless of label length -- a uniform
// grid of cards, not size-to-content boxes; long labels truncate with
// an ellipsis instead of stretching the card.
//
// Card shape (icon square + kind label + title stacked beside it) is
// adopted from the reference no-code platform's own node cards; the
// icon/color/kind text is Mill's own (KIND_ICON/KIND_ICON_BG/KIND_LABEL,
// nodeKind.ts) since Mill's node kinds are Capture/Process/Apply, not
// that reference's fuller Input/Decision/Ruleset/... taxonomy.
export function CanvasNodeView({ data, selected }: NodeProps<CanvasNode>) {
  const Icon = KIND_ICON[data.kind]
  // Trigger nodes have no target handle -- nothing should connect into
  // them, same as n8n's own trigger nodes having no input pin (they're
  // the entry point, not a step something else feeds).
  const isTrigger = data.kind === 'trigger'
  return (
    <div className={`${styles.canvasNode} ${selected ? styles.canvasNodeSelected : ''}`}>
      {!isTrigger && <Handle type="target" position={RFPosition.Top} />}
      <div className={styles.canvasNodeIcon} style={{ background: KIND_ICON_BG[data.kind] ?? 'var(--bgColor-neutral-emphasis)' }}>
        {Icon && <Icon size={16} fill="var(--fgColor-onEmphasis)" />}
      </div>
      <div className={styles.canvasNodeText}>
        <Text size="small" className={styles.canvasNodeKind}>{KIND_LABEL[data.kind] ?? data.kind}</Text>
        <Text size="small" weight="semibold" className={styles.canvasNodeLabel} title={data.label}>
          {data.label}
        </Text>
      </div>
      <Handle type="source" position={RFPosition.Bottom} />
    </div>
  )
}
