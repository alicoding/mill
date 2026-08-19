import { useTranslation } from 'react-i18next'
import { BaseEdge, EdgeLabelRenderer, getStraightPath, useInternalNode } from '@xyflow/react'
import type { Edge, EdgeProps } from '@xyflow/react'
import { IconButton } from '@primer/react'
import { ArrowSwitchIcon, TrashIcon } from '@primer/octicons-react'
import { floatingEdgeEndpoints } from './atlasEdgeGeometry'

export interface AtlasLinkEdgeData extends Record<string, unknown> {
  hovered: boolean
  // A non-aggregated (count === 1) edge names one real Link -- only
  // then does the hover chip's Delete/Change-kind pair make sense (an
  // aggregated artery has no per-link picker in this slice, same gate
  // the right-click artery menu already applies).
  count: number
  selected: boolean
  onDelete: () => void
  onChangeKind: (pos: { x: number; y: number }) => void
}

export type AtlasLinkRFEdge = Edge<AtlasLinkEdgeData, 'atlas-link'>

// A link drawn as a straight boundary-to-boundary line (React Flow's
// floating-edges pattern): each end attaches wherever its card
// actually faces the other card, computed from the nodes' absolute
// rects (atlasEdgeGeometry), never from the fixed hidden handles --
// whose default bezier routing looped links over frames and stranded
// labels in empty space. The label renders through EdgeLabelRenderer
// (a div layer that can stack ABOVE the node layer), not as SVG text
// in the edge layer: edges draw underneath nodes, so a label between
// two close cards was swallowed by the cards themselves. Hover can't
// cross those layers in CSS, so AtlasBoard feeds it in as data.hovered
// from its own onEdgeMouseEnter/Leave.
export function AtlasLinkEdge({ id, source, target, style, label, interactionWidth, data }: EdgeProps<AtlasLinkRFEdge>) {
  const { t } = useTranslation('atlas')
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  if (!sourceNode || !targetNode) return null

  const { sx, sy, tx, ty } = floatingEdgeEndpoints(
    {
      x: sourceNode.internals.positionAbsolute.x,
      y: sourceNode.internals.positionAbsolute.y,
      width: sourceNode.measured.width ?? 0,
      height: sourceNode.measured.height ?? 0,
    },
    {
      x: targetNode.internals.positionAbsolute.x,
      y: targetNode.internals.positionAbsolute.y,
      width: targetNode.measured.width ?? 0,
      height: targetNode.measured.height ?? 0,
    },
  )

  const [path, labelX, labelY] = getStraightPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty })
  // The chip only ever names one real Link (see AtlasLinkEdgeData's
  // own comment) and only while hovered or selected -- never
  // unconditionally, matching the label's own quiet-by-default rule.
  const chipVisible = (data?.count ?? 1) === 1 && (data?.hovered || data?.selected)

  return (
    <>
      <BaseEdge id={id} path={path} style={style} interactionWidth={interactionWidth} />
      <circle className="atlas-link-dot" cx={sx} cy={sy} r={2.5} />
      <circle className="atlas-link-dot" cx={tx} cy={ty} r={2.5} />
      {typeof label === 'string' && label !== '' && (
        <EdgeLabelRenderer>
          <div
            className="atlas-link-label"
            data-hovered={data?.hovered ? 'true' : 'false'}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
      {data && (
        <EdgeLabelRenderer>
          <div
            className="atlas-link-chip"
            data-visible={chipVisible ? 'true' : 'false'}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + 18}px)` }}
          >
            <IconButton
              icon={TrashIcon}
              size="small"
              variant="invisible"
              aria-label={t('contextMenu.removeLink')}
              data-testid="edge-delete"
              onClick={() => data.onDelete()}
            />
            <IconButton
              icon={ArrowSwitchIcon}
              size="small"
              variant="invisible"
              aria-label={t('contextMenu.changeLinkKind')}
              data-testid="edge-change-kind"
              onClick={(e) => data.onChangeKind({ x: e.clientX, y: e.clientY })}
            />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
