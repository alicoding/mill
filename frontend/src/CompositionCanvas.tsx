import { useCallback, useEffect, useState, type DragEvent } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  Handle,
  Position as RFPosition,
  useReactFlow,
} from '@xyflow/react'
import type { Connection, Edge as RFEdge, NodeTypes as RFNodeTypes, NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useStore } from 'zustand'
import { z } from 'zod'
import { Button, FormControl, IconButton, Label, Stack, Text, TextInput, Textarea } from '@primer/react'
import { ColumnsIcon, RedoIcon, SidebarCollapseIcon, SidebarExpandIcon, TrashIcon, UndoIcon } from '@primer/octicons-react'
import { ArrowLeftIcon } from '@primer/octicons-react'
import { CompositionService } from '../bindings/github.com/alicoding/mill'
import type { NodeType, Node as CompNode, Edge as CompEdge, Workflow } from '../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { createCanvasStore, type CanvasNode } from './canvasStore'
import { KIND_VARIANT } from './nodeKind'
import styles from './CompositionCanvas.module.css'
import runbookStyles from './RunbookView.module.css'

// Converts a persisted Workflow's Nodes/Edges (Wails' PascalCase wire
// shape) into React Flow's own node/edge shape, for loading an existing
// workflow onto the canvas to edit -- the inverse of save()'s mapping
// below. nodeTypes supplies each node's display label, since a stored
// Node only carries NodeTypeID, not the type's own Label.
function toCanvasNodes(nodes: CompNode[] | null, nodeTypes: NodeType[]): CanvasNode[] {
  return (nodes ?? []).map((n) => {
    const nt = nodeTypes.find((t) => t.ID === n.NodeTypeID)
    const config: Record<string, string> = {}
    for (const [k, v] of Object.entries(n.Config ?? {})) {
      if (v !== undefined) config[k] = v
    }
    return {
      id: n.ID,
      type: n.Kind,
      position: { x: n.Position?.X ?? 0, y: n.Position?.Y ?? 0 },
      data: { nodeTypeID: n.NodeTypeID, kind: n.Kind, label: nt?.Label ?? n.NodeTypeID, config },
    }
  })
}
function toRFEdges(edges: CompEdge[] | null): RFEdge[] {
  return (edges ?? []).map((e) => ({ id: e.ID, source: e.Source, target: e.Target, sourceHandle: e.SourceHandle || undefined }))
}

function CanvasNodeView({ data, selected }: NodeProps<CanvasNode>) {
  return (
    <div className={`${styles.canvasNode} ${selected ? styles.canvasNodeSelected : ''}`}>
      <Handle type="target" position={RFPosition.Left} />
      <Stack direction="horizontal" gap="condensed" align="center">
        <Label variant={KIND_VARIANT[data.kind] ?? 'secondary'} size="small">{data.kind}</Label>
        <Text size="small" weight="semibold">{data.label}</Text>
      </Stack>
      <Handle type="source" position={RFPosition.Right} />
    </div>
  )
}

const rfNodeTypes: RFNodeTypes = {
  capture: CanvasNodeView,
  process: CanvasNodeView,
  apply: CanvasNodeView,
}

// Validates a draft workflow before Save, against the Wails-generated
// PascalCase wire shape (composition/models.ts) -- not idiomatic
// camelCase -- since this validates exactly what CreateWorkflow will
// receive. The out-degree and edge-count checks mirror composition.go's
// own linearOrder validation, so a save-time error and a run-time error
// never disagree; the canvas's isValidConnection (below) additionally
// stops the disallowed shape from being drawn in the first place, so a
// user hits this validation only in edge cases (e.g. deleting a node
// that leaves the graph disconnected), not as the primary feedback loop.
const configSchema = z.record(z.string(), z.string())
const nodeSchema = z.object({
  ID: z.string().min(1),
  Kind: z.string(),
  NodeTypeID: z.string().min(1),
  Config: configSchema,
  Position: z.object({ X: z.number(), Y: z.number() }),
})
const edgeSchema = z.object({
  ID: z.string().min(1),
  Source: z.string().min(1),
  SourceHandle: z.string(),
  Target: z.string().min(1),
})
const draftWorkflowSchema = z
  .object({
    Label: z.string().trim().min(1, 'A workflow needs a label'),
    Description: z.string(),
    Nodes: z.array(nodeSchema).min(1, 'A workflow needs at least one node'),
    Edges: z.array(edgeSchema),
  })
  .superRefine((draft, ctx) => {
    const ids = new Set(draft.Nodes.map((n) => n.ID))
    const outDegree = new Map<string, number>()
    for (const e of draft.Edges) {
      if (!ids.has(e.Source) || !ids.has(e.Target)) {
        ctx.addIssue({ code: 'custom', message: 'A connection references a node that no longer exists.' })
      }
      outDegree.set(e.Source, (outDegree.get(e.Source) ?? 0) + 1)
    }
    if ([...outDegree.values()].some((n) => n > 1)) {
      ctx.addIssue({ code: 'custom', message: "A node can only have one outgoing connection today -- branching isn't supported yet." })
    }
    if (draft.Edges.length !== draft.Nodes.length - 1) {
      ctx.addIssue({ code: 'custom', message: 'Every node must be connected into a single chain, with no cycles.' })
    }
  })

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
  const updateNodeConfig = useCanvasStore((s) => s.updateNodeConfig)
  const removeSelected = useCanvasStore((s) => s.removeSelected)

  const canUndo = useStore(useCanvasStore.temporal, (s) => s.pastStates.length > 0)
  const canRedo = useStore(useCanvasStore.temporal, (s) => s.futureStates.length > 0)

  const { screenToFlowPosition } = useReactFlow()

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [draftLabel, setDraftLabel] = useState(workflow?.Label ?? '')
  const [draftDescription, setDraftDescription] = useState(workflow?.Description ?? '')
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
      // A brand-new workflow starts with a single capture node placed,
      // not a blank canvas -- the reference platform's own "Start from
      // Scratch" pre-populates an Input->Decision pair, but Mill has no
      // Decision node kind yet (ADR-0005/composition.go are explicit
      // that control-flow kinds aren't stubbed ahead of need), so this
      // seeds the one real node type that makes sense as a starting
      // point among Mill's actual four (capture/process/apply -- the
      // other three are either terminal or need input already flowing).
      const starterType = nodeTypes.find((nt) => nt.ID === 'capture-clipboard-html')
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

  // No Decision node kind exists yet (ADR-0005 A2 scopes that as
  // separate future work), so every node is implicitly max-out-degree-1
  // today -- reject a second outgoing edge from the same source at
  // draw-time rather than letting the backend reject it later at Run.
  const isValidConnection = useCallback(
    (connection: Connection | RFEdge) => !edges.some((e) => e.source === connection.source),
    [edges],
  )

  const onPaletteDragStart = (event: DragEvent<HTMLDivElement>, nt: NodeType) => {
    event.dataTransfer.setData('application/mill-node-type', nt.ID)
    event.dataTransfer.effectAllowed = 'move'
  }

  const onCanvasDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      const nodeTypeID = event.dataTransfer.getData('application/mill-node-type')
      const nt = nodeTypes.find((n) => n.ID === nodeTypeID)
      if (!nt) return
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
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
    [nodeTypes, screenToFlowPosition, addNode],
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
        layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.spacing.nodeNode': '48' },
        children: currentNodes.map((n) => ({ id: n.id, width: 180, height: 56 })),
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
        SourceHandle: e.sourceHandle ?? '',
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
        <Stack direction="vertical" gap="condensed">
          <FormControl>
            <FormControl.Label>Label</FormControl.Label>
            <TextInput value={draftLabel} onChange={(e) => setDraftLabel(e.target.value)} placeholder="My workflow" block />
          </FormControl>
          <FormControl>
            <FormControl.Label>Description</FormControl.Label>
            <Textarea value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} rows={2} block />
          </FormControl>
          {saveError && <Text as="p" size="small" className={runbookStyles.error}>{saveError}</Text>}
          <Stack direction="horizontal">
            <Button variant="primary" onClick={save} disabled={saving} data-testid="save-workflow">
              {saving ? 'Saving…' : workflow ? 'Save changes' : 'Save workflow'}
            </Button>
          </Stack>
        </Stack>
      </div>

      <div className={styles.canvasWrap}>
        {paletteOpen && (
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
                    <Label variant={KIND_VARIANT[nt.Kind] ?? 'secondary'} size="small">{nt.Kind}</Label>
                    <Text size="small">{nt.Label}</Text>
                  </Stack>
                </div>
              ))}
            </Stack>
          </div>
        )}
        <div className={styles.canvas} onDrop={onCanvasDrop} onDragOver={(e) => e.preventDefault()}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            nodeTypes={rfNodeTypes}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
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

        <div className={styles.inspector} data-testid="composition-inspector">
          {!selectedNode && <Text className={styles.inspectorEmpty} size="small">Select a node to configure it.</Text>}
          {selectedNode && (
            <Stack direction="vertical" gap="condensed">
              <Text weight="semibold">{selectedNode.data.label}</Text>
              {(selectedNodeType?.ConfigFields ?? []).length === 0 && (
                <Text size="small" className={runbookStyles.muted}>This node type takes no configuration.</Text>
              )}
              {(selectedNodeType?.ConfigFields ?? []).map((field) => (
                <FormControl key={field.Key}>
                  <FormControl.Label>{field.Label}</FormControl.Label>
                  {field.Description && <FormControl.Caption>{field.Description}</FormControl.Caption>}
                  <Textarea
                    defaultValue={selectedNode.data.config[field.Key] ?? ''}
                    rows={4}
                    block
                    data-testid="canvas-config-field"
                    onBlur={(e) => updateNodeConfig(selectedNode.id, field.Key, e.target.value)}
                  />
                </FormControl>
              ))}
            </Stack>
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
