import { useState } from 'react'
import type { Edge as RFEdge } from '@xyflow/react'
import type { Issue, NodeType } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { CanvasNode } from './canvasStore'
import { contractLine } from './payloadKinds'
import type { ContextMenuState } from '../shared/ContextMenu'

// The canvas's selection/detail/context-menu cluster -- split out of
// CompositionCanvas.tsx at the 500-line limit (.claude/rules/
// architecture.md), same "split along a real seam" discipline every
// other useCanvasXxx hook in this file already established (notes,
// auto-layout, hot exit, live sync, clipboard, context-menu handlers).
// Zero behavior change: every field/handler here is exactly what
// CompositionCanvas.tsx held inline before.
export function useCanvasSelection(nodes: CanvasNode[], edges: RFEdge[], nodeTypes: NodeType[], changeNodeType: (id: string, nodeTypeID: string, label: string, config: Record<string, string>, output: string, contractLineValue: string) => void, updateNodeConfig: (id: string, key: string, value: string) => void) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  // The step-detail overlay (docs/goals/0058) is a boolean over the
  // CURRENT selection, not a separate node id -- it only ever opens for
  // whatever's already selected (a canvas double-click selects-then-
  // opens; the sidebar's expand button only exists once a node is
  // already selected), so there's no case where it should show a
  // different node than the sidebar itself.
  const [detailOpen, setDetailOpen] = useState(false)
  // The canvas's right-click menu (goal 0075) -- one state shared by
  // step/edge/pane openers, see useCanvasContextMenuHandlers.ts.
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  // A validation-panel row selects its offending node/edge, same target
  // onNodeClick/onEdgeClick already write to.
  const selectIssue = (issue: Issue) => {
    if (issue.NodeID) {
      setSelectedNodeId(issue.NodeID)
      setSelectedEdgeId(null)
    } else if (issue.EdgeID) {
      setSelectedEdgeId(issue.EdgeID)
      setSelectedNodeId(null)
    }
  }

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null
  const selectedNodeType = selectedNode ? nodeTypes.find((nt) => nt.ID === selectedNode.data.nodeTypeID) : undefined
  // Every NodeType sharing the selected node's Kind -- what the
  // "Node type" Inspector control offers as a swap target. Kind never
  // changes on swap, so isValidConnection's per-kind edge rules and any
  // edges already drawn to/from this node stay valid untouched.
  const sameKindNodeTypes = selectedNode ? nodeTypes.filter((nt) => nt.Kind === selectedNode.data.kind) : []
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null
  // Only a Decision node's outgoing edges carry a real condition to
  // configure (SPEC.md §3.5) -- an edge selected off any other node kind
  // has nothing for this Inspector branch to show.
  const selectedEdgeFromDecision = selectedEdge && nodes.find((n) => n.id === selectedEdge.source)?.data.kind === 'decision'

  // Bound to the selected node once here rather than in each renderer --
  // both the sidebar inspector and the step-detail overlay (docs/goals/0058)
  // need the identical pair for the identical selection.
  const handleChangeNodeType = (newType: NodeType) => {
    if (!selectedNode) return
    const config: Record<string, string> = {}
    for (const field of newType.ConfigFields ?? []) config[field.Key] = field.Default
    changeNodeType(selectedNode.id, newType.ID, newType.Label, config, newType.Output ?? '', contractLine(newType))
  }
  const handleNodeConfigChange = (key: string, value: string) => {
    if (!selectedNode) return
    updateNodeConfig(selectedNode.id, key, value)
  }

  return {
    selectedNodeId, setSelectedNodeId,
    selectedEdgeId, setSelectedEdgeId,
    detailOpen, setDetailOpen,
    contextMenu, setContextMenu,
    selectIssue,
    selectedNode, selectedNodeType, sameKindNodeTypes,
    selectedEdge, selectedEdgeFromDecision,
    handleChangeNodeType, handleNodeConfigChange,
  }
}
