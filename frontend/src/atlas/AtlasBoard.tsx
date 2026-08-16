import { useEffect, useMemo, useState } from 'react'
import { ReactFlow, ReactFlowProvider, Background, Controls, useNodesState } from '@xyflow/react'
import type { NodeTypes as RFNodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ViewMode } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { Card, Kind, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { useIsNarrowViewport } from '../shared/useNarrowViewport'
import { childrenOf } from './atlasGrouping'
import { computeAutoArrangeLayout, computeGroupFrameLayout, isGroupCard, NOTE_HEIGHT, NOTE_WIDTH } from './atlasBoardLayout'
import { computeFreshnessRollup } from './atlasCardPresentation'
import { AtlasNoteCardNode, type AtlasNoteCardRFNode } from './AtlasNoteCardNode'
import { AtlasGroupNode, type AtlasGroupRFNode } from './AtlasGroupNode'
import styles from './AtlasBoard.module.css'

const rfNodeTypes: RFNodeTypes = { 'atlas-note': AtlasNoteCardNode, 'atlas-group': AtlasGroupNode }

type BoardRFNode = AtlasNoteCardRFNode | AtlasGroupRFNode

// The one board every level renders through (goal 0072 slice A,
// retiring the old canvas/shelves split): Auto-arrange positions
// (deterministic, atlasBoardLayout.ts, never persisted, dragging off)
// vs Free (saved Position, drag persists via SetPosition) is a prop,
// not two components. A card with children renders as a region frame
// (AtlasGroupNode) whose own direct children render as separate,
// non-draggable preview nodes anchored inside it (parentId +
// extent:'parent') -- one nesting level deep, regardless of board
// mode; a childless card renders as a flippable note (AtlasNoteCardNode).
function AtlasBoardInner({ cards, allCards, kinds, links, linkKinds, mode, onDrill, onOpenOverlay }: {
  cards: Card[]
  allCards: Card[]
  kinds: Kind[]
  links: Link[]
  linkKinds: LinkKind[]
  mode: ViewMode
  onDrill: (id: string) => void
  onOpenOverlay: (id: string) => void
}) {
  const readOnly = useIsNarrowViewport()
  const isFree = mode === ViewMode.ViewModeCanvas
  const [flippedID, setFlippedID] = useState<string | null>(null)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFlippedID(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const toggleFlip = (id: string) => setFlippedID((cur) => (cur === id ? null : id))

  const { builtNodes, renderedIDs } = useMemo(() => {
    const kindByID = new Map(kinds.map((k) => [k.ID, k]))
    const autoLayout = !isFree ? computeAutoArrangeLayout(cards, allCards) : null
    const nodes: BoardRFNode[] = []
    const ids = new Set<string>()

    const noteData = (card: Card) => ({
      card,
      kind: kindByID.get(card.KindID),
      allCards,
      links,
      linkKinds,
      flipped: flippedID === card.ID,
      onToggleFlip: toggleFlip,
      onOpenOverlay,
    })

    for (const card of cards) {
      const box = autoLayout?.boxes.get(card.ID)
      const position = isFree ? { x: card.Position?.X ?? 0, y: card.Position?.Y ?? 0 } : { x: box?.x ?? 0, y: box?.y ?? 0 }

      if (isGroupCard(allCards, card)) {
        const frame = computeGroupFrameLayout(allCards, card.ID)
        const size = isFree ? frame.size : { width: box?.width ?? frame.size.width, height: box?.height ?? frame.size.height }
        ids.add(card.ID)
        nodes.push({
          id: card.ID,
          type: 'atlas-group',
          position,
          width: size.width,
          height: size.height,
          draggable: isFree && !readOnly,
          data: {
            card,
            kind: kindByID.get(card.KindID),
            childCount: childrenOf(allCards, card.ID).length,
            freshness: computeFreshnessRollup(frame.children.map((c) => c.card)),
            onDrill,
          },
        })
        for (const child of frame.children) {
          ids.add(child.card.ID)
          nodes.push({
            id: child.card.ID,
            type: 'atlas-note',
            position: child.position,
            width: NOTE_WIDTH,
            height: NOTE_HEIGHT,
            parentId: card.ID,
            extent: 'parent',
            draggable: false,
            data: noteData(child.card),
          })
        }
      } else {
        ids.add(card.ID)
        nodes.push({
          id: card.ID,
          type: 'atlas-note',
          position,
          width: NOTE_WIDTH,
          height: NOTE_HEIGHT,
          draggable: isFree && !readOnly,
          data: noteData(card),
        })
      }
    }
    return { builtNodes: nodes, renderedIDs: ids }
  }, [cards, allCards, kinds, links, linkKinds, isFree, readOnly, flippedID, onDrill, onOpenOverlay])

  const edges = useMemo(() => {
    const visible = links.filter((l) => renderedIDs.has(l.FromCardID) && renderedIDs.has(l.ToCardID))
    const linkKindByID = new Map(linkKinds.map((lk) => [lk.ID, lk]))
    return visible.map((l) => ({
      id: l.ID,
      source: l.FromCardID,
      target: l.ToCardID,
      type: 'default',
      label: linkKindByID.get(l.LinkKindID)?.Label ?? '',
      style: { stroke: 'var(--fgColor-accent)', strokeWidth: 1.6, opacity: 0.75 },
      labelStyle: { fontFamily: 'var(--mill-mono)', fontSize: 9 },
      interactionWidth: 8,
    }))
  }, [links, linkKinds, renderedIDs])

  const [nodes, setNodes, onNodesChange] = useNodesState(builtNodes)
  useEffect(() => {
    setNodes(builtNodes)
  }, [builtNodes, setNodes])

  return (
    <div className={`${styles.board} ${edges.length <= 3 ? styles.alwaysShowLabels : ''}`} data-testid="atlas-board" data-view-mode={mode}>
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        edges={edges}
        nodeTypes={rfNodeTypes}
        nodesConnectable={false}
        nodesDraggable={isFree && !readOnly}
        zoomOnDoubleClick={false}
        // Narrow viewports never zoom out past 100% -- a board wider
        // than the screen pans instead of auto-shrinking every card
        // below its own real CSS pixel size (a touch target,
        // kind-glyph text) into an untappable miniature. Wide
        // viewports keep deep zoom-out (0.1): seeing the whole board
        // at once is the surface's core navigation model, and a
        // higher floor caps fitView on large boards. Separate from
        // fitViewOptions' maxZoom below (which only caps fitView's
        // own one-time zoom-IN on a sparse board).
        minZoom={readOnly ? 1 : 0.1}
        onNodeDragStop={
          isFree && !readOnly
            ? (_, node) => {
                if (node.parentId) return
                void AtlasService.SetPosition(node.id, { X: node.position.x, Y: node.position.y }).catch(console.error)
              }
            : undefined
        }
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.25 }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}

export function AtlasBoard(props: Parameters<typeof AtlasBoardInner>[0]) {
  return (
    <ReactFlowProvider>
      <AtlasBoardInner {...props} />
    </ReactFlowProvider>
  )
}
