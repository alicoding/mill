import { useCallback, useEffect, useState, type DragEvent } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  useReactFlow,
} from '@xyflow/react'
import type { Connection, Edge as RFEdge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useStore } from 'zustand'
import { Button, FormControl, IconButton, Stack, Text, TextInput, Textarea } from '@primer/react'
import { ChevronDownIcon, ChevronUpIcon, ColumnsIcon, RedoIcon, SidebarCollapseIcon, SidebarExpandIcon, TrashIcon, UndoIcon } from '@primer/octicons-react'
import { ArrowLeftIcon } from '@primer/octicons-react'
import { CompositionService } from '../bindings/github.com/alicoding/mill'
import type { NodeType, Node as CompNode, Edge as CompEdge, Workflow } from '../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { createCanvasStore, type CanvasNode } from './canvasStore'
import { rfNodeTypes } from './rfNodeTypes'
import { CANVAS_NODE_WIDTH, CANVAS_NODE_HEIGHT } from './canvasConstants'
import { findFreeDropPosition } from './canvasLayout'
import { toCanvasNodes, toRFEdges } from './canvasConversion'
import { draftWorkflowSchema } from './draftWorkflowSchema'
import { NodePalette } from './NodePalette'
import { DecisionEdgeInspector } from './DecisionEdgeInspector'
import { NodeInspector } from './NodeInspector'
import { useHotkeyCapture } from './hotkeyCapture'
import styles from './CompositionCanvas.module.css'
import runbookStyles from './ListCard.module.css'

interface CompositionCanvasProps {
  nodeTypes: NodeType[]
  // The workflow being edited -- undefined/null means composing a new
  // one. Mount-keyed by the caller (CompositionView.tsx passes a `key`
  // derived from the workflow's id, or "new"), so this component only
  // ever needs to load its initial data once, on mount -- switching
  // targets is a fresh mount, not a prop update to react to.
  workflow?: Workflow | null
  onBack: () => void
  onSaved: () => void
}

// A prototype canvas for SPEC.md §3 / ADR-0005 -- built ahead of B2's
// original "2+ real multi-step workflows exist" deferral trigger, by
// explicit decision (see the ADR's Update section). Composing a node
// always configures it (SPEC.md §3's locked principle): a dropped node
// gets its node type's default config immediately, editable via the
// Inspector the moment it's selected, never a bare unconfigured
// reference.
function CanvasInner({ nodeTypes, workflow, onBack, onSaved }: CompositionCanvasProps) {
  // One store per mounted CanvasInner -- tabbed multi-editing
  // (CompositionView.tsx) can have several of these mounted at once,
  // each needing independent nodes/edges/undo history rather than
  // sharing one global canvas.
  const [useCanvasStore] = useState(() => createCanvasStore())

  const [paletteOpen, setPaletteOpen] = useState(false)

  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const onNodesChange = useCanvasStore((s) => s.onNodesChange)
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange)
  const onConnect = useCanvasStore((s) => s.onConnect)
  const addNode = useCanvasStore((s) => s.addNode)
  const changeNodeType = useCanvasStore((s) => s.changeNodeType)
  const updateNodeConfig = useCanvasStore((s) => s.updateNodeConfig)
  const updateEdgeCondition = useCanvasStore((s) => s.updateEdgeCondition)
  const removeSelected = useCanvasStore((s) => s.removeSelected)

  const canUndo = useStore(useCanvasStore.temporal, (s) => s.pastStates.length > 0)
  const canRedo = useStore(useCanvasStore.temporal, (s) => s.futureStates.length > 0)

  // A workflow needs a real ID to bind a hotkey to -- null while
  // composing a brand-new, not-yet-saved workflow (workflow prop is
  // null/undefined then). The Inspector below shows "save first" in that
  // case rather than silently disabling the control with no explanation.
  const hotkeyCapture = useHotkeyCapture(workflow?.ID ?? null)

  const { screenToFlowPosition } = useReactFlow()

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [draftLabel, setDraftLabel] = useState(workflow?.Label ?? '')
  const [draftDescription, setDraftDescription] = useState(workflow?.Description ?? '')
  // Collapsed by default unless a description already exists -- the
  // canvas is the authoring surface, the header is metadata (SPEC.md
  // §3's canvas-first layout pass); Label stays a normal always-visible
  // input either way (it's the one field every workflow needs, and
  // hiding it behind a toggle would just move the friction, not remove
  // it), only Description -- optional, used less -- is worth a
  // disclosure.
  const [descOpen, setDescOpen] = useState(!!workflow?.Description)
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [layingOut, setLayingOut] = useState(false)

  // Runs once per mount -- the caller remounts this component (via a
  // `key` keyed on the workflow's id) whenever the editing target
  // changes, so "load the target's data" and "start fresh" both reduce
  // to "do it once, here."
  useEffect(() => {
    if (workflow) {
      useCanvasStore.getState().load(toCanvasNodes(workflow.Nodes, nodeTypes), toRFEdges(workflow.Edges))
    } else {
      // A brand-new workflow starts with a single trigger node placed,
      // not a blank canvas -- matches the reference platform's own
      // "Start from Scratch" pre-populating a starting node. Now that a
      // real Trigger NodeKind exists (SPEC.md §3.4), the natural starter
      // is trigger-manual specifically: every workflow needs exactly one
      // root, and a manual trigger is the one that needs no external
      // config (hotkey/schedule/watch all need a value the user hasn't
      // supplied yet).
      const starterType = nodeTypes.find((nt) => nt.ID === 'trigger-manual')
      if (starterType) {
        useCanvasStore.getState().load(
          [
            {
              id: crypto.randomUUID(),
              type: starterType.Kind,
              position: { x: 80, y: 80 },
              data: { nodeTypeID: starterType.ID, kind: starterType.Kind, label: starterType.Label, config: {} },
            },
          ],
          [],
        )
      } else {
        useCanvasStore.getState().clear()
      }
    }
    useCanvasStore.temporal.getState().clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null
  const selectedNodeType = selectedNode ? nodeTypes.find((nt) => nt.ID === selectedNode.data.nodeTypeID) : undefined
  // Every NodeType sharing the selected node's Kind -- what the
  // "Node type" Inspector control below offers as a swap target. Kind
  // never changes on swap, so isValidConnection's per-kind edge rules
  // and any edges already drawn to/from this node stay valid untouched.
  const sameKindNodeTypes = selectedNode ? nodeTypes.filter((nt) => nt.Kind === selectedNode.data.kind) : []
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null
  // Only a Decision node's outgoing edges carry a real condition to
  // configure (SPEC.md §3.5) -- an edge selected off any other node kind
  // has nothing for this Inspector branch to show.
  const selectedEdgeFromDecision = selectedEdge && nodes.find((n) => n.id === selectedEdge.source)?.data.kind === 'decision'

  // Every node kind except Decision is max-out-degree-1 -- the backend's
  // buildGraph (composition.go) enforces this same rule at save/run time
  // ("a save-time error and a run-time error never disagree"), this is
  // just the draw-time layer of it. A Decision node's whole purpose is
  // multiple named outgoing branches (SPEC.md §3.5), so it's the one kind
  // exempt from the single-outgoing-edge limit.
  const isValidConnection = useCallback(
    (connection: Connection | RFEdge) => {
      const source = nodes.find((n) => n.id === connection.source)
      if (source?.data.kind !== 'decision' && edges.some((e) => e.source === connection.source)) return false
      // Nothing connects into a trigger node -- it's the entry point, not
      // a step something else feeds (matches CanvasNodeView omitting the
      // target handle for trigger nodes; this is the draw-time layer of
      // the same rule, belt-and-suspenders with the missing handle).
      const target = nodes.find((n) => n.id === connection.target)
      if (target?.data.kind === 'trigger') return false
      return true
    },
    [edges, nodes],
  )

  const onCanvasDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      const nodeTypeID = event.dataTransfer.getData('application/mill-node-type')
      const nt = nodeTypes.find((n) => n.ID === nodeTypeID)
      if (!nt) return
      // A workflow's Trigger nodes are always graph roots (isValidConnection
      // above already refuses an edge into one), so a second one always
      // breaks findRoot's "exactly one starting node" rule server-side --
      // the palette already disables Trigger entries once one exists, this
      // is belt-and-suspenders against a drop event that got through some
      // other way (e.g. a stale drag started before the first trigger was
      // placed).
      if (nt.Kind === 'trigger' && nodes.some((n) => n.data.kind === 'trigger')) return
      const desired = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const position = findFreeDropPosition(desired, nodes)
      const config: Record<string, string> = {}
      for (const field of nt.ConfigFields ?? []) config[field.Key] = field.Default
      const node: CanvasNode = {
        id: crypto.randomUUID(),
        type: nt.Kind,
        position,
        data: { nodeTypeID: nt.ID, kind: nt.Kind, label: nt.Label, config },
      }
      addNode(node)
    },
    [nodeTypes, nodes, screenToFlowPosition, addNode],
  )

  // elkjs is a large (~1-2MB) synchronous bundle -- dynamically imported
  // only when Auto-layout is actually clicked, not part of the main
  // chunk embedded via //go:embed.
  const runAutoLayout = useCallback(async () => {
    setLayingOut(true)
    try {
      const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
      const elk = new ELK()
      const { nodes: currentNodes, edges: currentEdges } = useCanvasStore.getState()
      const graph = {
        id: 'root',
        // DOWN, not RIGHT -- matches the top/bottom handle positions
        // above, so an auto-laid-out chain reads as one straight column
        // with each edge centered under the node above it, not a
        // diagonal left-to-right sprawl.
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'DOWN',
          'elk.spacing.nodeNode': '48',
          'elk.layered.spacing.nodeNodeBetweenLayers': '64',
        },
        children: currentNodes.map((n) => ({ id: n.id, width: CANVAS_NODE_WIDTH, height: CANVAS_NODE_HEIGHT })),
        edges: currentEdges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
      }
      const layouted = await elk.layout(graph)
      const byId = new Map((layouted.children ?? []).map((c) => [c.id, c]))
      const positioned = currentNodes.map((n) => {
        const l = byId.get(n.id)
        return l && l.x !== undefined && l.y !== undefined ? { ...n, position: { x: l.x, y: l.y } } : n
      })
      useCanvasStore.getState().load(positioned, currentEdges)
    } finally {
      setLayingOut(false)
    }
  }, [useCanvasStore])

  const save = async () => {
    setSaveError('')
    const draft = {
      Label: draftLabel,
      Description: draftDescription,
      Nodes: nodes.map((n) => ({
        ID: n.id,
        Kind: n.data.kind,
        NodeTypeID: n.data.nodeTypeID,
        Config: n.data.config,
        Position: { X: n.position.x, Y: n.position.y },
      })),
      Edges: edges.map((e) => ({
        ID: e.id,
        Source: e.source,
        SourceHandle: (e.data as { condition?: string } | undefined)?.condition ?? '',
        Target: e.target,
      })),
    }
    const parsed = draftWorkflowSchema.safeParse(draft)
    if (!parsed.success) {
      setSaveError(parsed.error.issues[0]?.message ?? 'This workflow is not valid yet.')
      return
    }
    setSaving(true)
    try {
      if (workflow) {
        await CompositionService.UpdateWorkflow(
          workflow.ID,
          parsed.data.Label,
          parsed.data.Description,
          parsed.data.Nodes as CompNode[],
          parsed.data.Edges as CompEdge[],
        )
      } else {
        await CompositionService.CreateWorkflow(
          parsed.data.Label,
          parsed.data.Description,
          parsed.data.Nodes as CompNode[],
          parsed.data.Edges as CompEdge[],
        )
      }
      onSaved()
    } catch (err) {
      setSaveError(String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.canvasSection} data-testid="composition-canvas">
      <div className={styles.metaHeader}>
        <Stack direction="horizontal" gap="condensed" align="center">
          <TextInput
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            aria-label="Label"
            placeholder="My workflow"
            size="small"
            className={styles.metaTitleInput}
          />
          <IconButton
            icon={descOpen ? ChevronUpIcon : ChevronDownIcon}
            aria-label={descOpen ? 'Hide details' : 'Add details'}
            size="small"
            onClick={() => setDescOpen((v) => !v)}
            data-testid="toggle-description"
          />
          <Button variant="primary" size="small" onClick={save} disabled={saving} data-testid="save-workflow">
            {saving ? 'Saving…' : workflow ? 'Save changes' : 'Save workflow'}
          </Button>
        </Stack>
        {saveError && <Text as="p" size="small" className={runbookStyles.error}>{saveError}</Text>}
        {descOpen && (
          <FormControl className={styles.metaDescription}>
            <FormControl.Label>Description</FormControl.Label>
            <Textarea value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} rows={2} block />
          </FormControl>
        )}
      </div>

      <div className={styles.canvasWrap}>
        {paletteOpen && <NodePalette nodeTypes={nodeTypes} hasTrigger={nodes.some((n) => n.data.kind === 'trigger')} />}
        <div className={styles.canvas} onDrop={onCanvasDrop} onDragOver={(e) => e.preventDefault()}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            nodeTypes={rfNodeTypes}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id)
              setSelectedEdgeId(null)
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id)
              setSelectedNodeId(null)
            }}
            onPaneClick={() => {
              setSelectedNodeId(null)
              setSelectedEdgeId(null)
            }}
            onNodeDragStart={() => useCanvasStore.temporal.getState().pause()}
            onNodeDragStop={() => useCanvasStore.temporal.getState().resume()}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
            <Panel position="top-left" className={styles.canvasToolbar}>
              <Stack direction="horizontal" gap="condensed" align="center">
                <IconButton icon={ArrowLeftIcon} aria-label="Back to workflows" size="small" onClick={onBack} />
                <IconButton
                  icon={paletteOpen ? SidebarCollapseIcon : SidebarExpandIcon}
                  aria-label={paletteOpen ? 'Hide add steps panel' : 'Add steps'}
                  size="small"
                  onClick={() => setPaletteOpen((v) => !v)}
                  data-testid="toggle-palette"
                />
                <IconButton icon={UndoIcon} aria-label="Undo" size="small" disabled={!canUndo} onClick={() => useCanvasStore.temporal.getState().undo()} />
                <IconButton icon={RedoIcon} aria-label="Redo" size="small" disabled={!canRedo} onClick={() => useCanvasStore.temporal.getState().redo()} />
                <IconButton icon={ColumnsIcon} aria-label="Auto-layout" size="small" disabled={layingOut || nodes.length === 0} onClick={runAutoLayout} />
                <IconButton icon={TrashIcon} aria-label="Delete selected" size="small" onClick={removeSelected} />
                <Text size="small" className={runbookStyles.muted}>
                  Add steps to drag a node type onto the canvas, connect them, click a node to configure it.
                </Text>
              </Stack>
            </Panel>
          </ReactFlow>
        </div>

        <div
          className={`${styles.inspector} ${!selectedNode && !selectedEdge ? styles.inspectorCollapsed : ''}`}
          data-testid="composition-inspector"
        >
          {!selectedNode && !selectedEdgeFromDecision && (
            <Text className={styles.inspectorEmpty} size="small">
              {selectedEdge ? 'Only a Decision node’s outgoing edges are configurable.' : 'Select a node to configure it.'}
            </Text>
          )}
          {selectedEdgeFromDecision && selectedEdge && (
            <DecisionEdgeInspector
              edgeId={selectedEdge.id}
              condition={(selectedEdge.data as { condition?: string } | undefined)?.condition ?? ''}
              attrs={workflow?.Attributes}
              onApply={(condition) => updateEdgeCondition(selectedEdge.id, condition)}
            />
          )}
          {selectedNode && (
            <NodeInspector
              key={selectedNode.id}
              node={selectedNode}
              nodeType={selectedNodeType}
              sameKindNodeTypes={sameKindNodeTypes}
              hasWorkflow={!!workflow}
              hotkeyCapture={hotkeyCapture}
              onChangeType={(newType) => {
                const config: Record<string, string> = {}
                for (const field of newType.ConfigFields ?? []) config[field.Key] = field.Default
                changeNodeType(selectedNode.id, newType.ID, newType.Label, config)
              }}
              onConfigChange={(key, value) => updateNodeConfig(selectedNode.id, key, value)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function CompositionCanvas(props: CompositionCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}

export default CompositionCanvas
