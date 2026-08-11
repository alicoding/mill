import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
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
import { GuardrailService } from '../shared/bindings'
import { Button, FormControl, IconButton, Stack, Text, TextInput, Textarea } from '@primer/react'
import { ChevronDownIcon, ChevronUpIcon, ColumnsIcon, RedoIcon, SidebarCollapseIcon, SidebarExpandIcon, TrashIcon, UndoIcon } from '@primer/octicons-react'
import { ArrowLeftIcon } from '@primer/octicons-react'
import { CompositionService } from '../shared/bindings'
import type { NodeType, Node as CompNode, Edge as CompEdge, Workflow, Issue } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { createCanvasStore, type CanvasNode } from './canvasStore'
import { rfNodeTypes } from './rfNodeTypes'
import { CANVAS_NODE_WIDTH, CANVAS_NODE_HEIGHT } from './canvasConstants'
import { findFreeDropPosition } from './canvasLayout'
import { draftWorkflowSchema } from './draftWorkflowSchema'
import { toDraftEdges, toDraftNodes } from './draftPayload'
import { clearScratch } from './canvasScratch'
import { computeInitialCanvas, useCanvasHotExit } from './useCanvasHotExit'
import { useDraftValidation, groupIssuesByNode } from './useDraftValidation'
import { ValidationSurface } from './ValidationPanel'
import { NodePalette } from './NodePalette'
import { DecisionEdgeInspector } from './DecisionEdgeInspector'
import { NodeInspector } from './NodeInspector'
import { useHotkeyCapture } from './hotkeyCapture'
import { RunStateContext, useLiveRun } from './liveRunState'
import { CurrentStepBar, RunButton, type RunButtonHandle } from './LiveRunControls'
import { useCanvasCommandDispatch } from './useCanvasCommandDispatch'
import styles from './CompositionCanvas.module.css'
import runbookStyles from '../shared/ListCard.module.css'

interface CompositionCanvasProps {
  nodeTypes: NodeType[]
  // The workflow being edited -- undefined/null means composing a new
  // one. Mount-keyed by the caller (CompositionView.tsx passes a `key`
  // derived from the workflow's id, or "new"), so this component only
  // ever needs to load its initial data once, on mount -- switching
  // targets is a fresh mount, not a prop update to react to.
  workflow?: Workflow | null
  // The owning WorkTab's own identity (shared/store.ts) -- this canvas's
  // hot-exit scratch key (docs/goals/0012-authoring-hot-exit.md,
  // canvasScratch.ts). Stable across a reload for any tab that survives
  // one (workflow-edit/workflow-new are both restorable now), and freshly
  // generated for a brand-new tab -- either way, one canvas = one key,
  // never shared between two mounted editors.
  tabKey: string
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
function CanvasInner({ nodeTypes, workflow, tabKey, onBack, onSaved }: CompositionCanvasProps) {
  // Computed once, synchronously, at first render -- see
  // computeInitialCanvas's own doc comment for why this isn't a
  // useEffect. `initial.baseline` (docs/goals/0012) is what every later
  // dirty check compares the live draft against: the saved workflow's
  // real content (or the empty-starter content for a new workflow),
  // never the restored scratch itself -- so a restored-but-unedited-
  // since-restore canvas still reads as dirty until an actual Save.
  const [initial] = useState(() => computeInitialCanvas(workflow, nodeTypes, tabKey))

  // One store per mounted CanvasInner -- tabbed multi-editing
  // (CompositionView.tsx) can have several of these mounted at once,
  // each needing independent nodes/edges/undo history rather than
  // sharing one global canvas.
  const [useCanvasStore] = useState(() => createCanvasStore(initial.nodes, initial.edges))

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
  const setGuardrailVerdicts = useCanvasStore((s) => s.setGuardrailVerdicts)
  const setValidationIssues = useCanvasStore((s) => s.setValidationIssues)

  const canUndo = useStore(useCanvasStore.temporal, (s) => s.pastStates.length > 0)
  const canRedo = useStore(useCanvasStore.temporal, (s) => s.futureStates.length > 0)

  // A workflow needs a real ID to bind a hotkey to -- null while
  // composing a brand-new, not-yet-saved workflow (workflow prop is
  // null/undefined then). The Inspector below shows "save first" in that
  // case rather than silently disabling the control with no explanation.
  const hotkeyCapture = useHotkeyCapture(workflow?.ID ?? null)

  // The keymap system's workflow.save/workflow.run commands reach this
  // specific mounted canvas via useCanvasCommandDispatch, below (see
  // its own header comment) -- runButtonRef lets the 'run' case reuse
  // RunButton's own attrs-check-then-dialog logic instead of
  // duplicating it here.
  const runButtonRef = useRef<RunButtonHandle>(null)

  // Live run state (docs/SPEC.md §3.8's authoring-style direction, item
  // #2) -- the run currently displayed on this canvas, either started
  // from the Run button below or already in flight when this editor
  // opened. Never touches useCanvasStore (zundo-wrapped undo history,
  // §3.3) -- see liveRunState.ts's own header comment.
  const { detail: liveRunDetail, statusByNodeId: liveStepStatusByNodeId, barState, startRun, resolve: resolveApprovalStep, dismiss: dismissRunState } = useLiveRun(workflow?.ID)

  // GetRun's steps only ever cover Capture/Process/Apply/Decision-
  // adjacent nodes -- a Trigger node never checkpoints its own step, so
  // it gets no signal from liveStepStatusByNodeId at all. It fired by
  // definition the moment any run is displayed, so it's marked done here
  // rather than left blank.
  const statusByNodeId = useMemo(() => {
    if (!liveRunDetail) return liveStepStatusByNodeId
    const merged = { ...liveStepStatusByNodeId }
    for (const n of nodes) {
      if (n.data.kind === 'trigger') merged[n.id] = 'done'
    }
    return merged
  }, [liveStepStatusByNodeId, liveRunDetail, nodes])
  const runStateContextValue = useMemo(() => ({ statusByNodeId }), [statusByNodeId])

  // Nothing-hidden guardrail badges (docs/adr/0022's Update): fetch the
  // saved workflow's per-step verdicts so a step that will ask or deny
  // is marked on the canvas before anyone runs it. Keyed on node
  // membership/type/config so adding an external step or repointing a
  // requestId refreshes the badge; a brand-new unsaved workflow has no
  // ID to evaluate against yet (badges appear after the first save).
  const nodeFingerprint = nodes.map((n) => `${n.id}:${n.data.nodeTypeID}:${n.data.config.requestId ?? ''}`).join('|')
  useEffect(() => {
    if (!workflow?.ID) return
    GuardrailService.WorkflowVerdicts(workflow.ID)
      .then((v) => setGuardrailVerdicts((v ?? {}) as Record<string, { effect: string; ruleLabel: string }>))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow?.ID, nodeFingerprint])

  // Authoring-validation surface (docs/adr/0028): debounced live
  // ValidateDraft, mirrored onto every node's own badge the same way
  // guardrail verdicts are above -- see useDraftValidation.ts.
  const validationIssues = useDraftValidation(nodes, edges, workflow?.Attributes)
  useEffect(() => {
    setValidationIssues(groupIssuesByNode(validationIssues))
  }, [validationIssues, setValidationIssues])

  const { screenToFlowPosition } = useReactFlow()

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  // A validation-panel row selects its offending node/edge, same target
  // onNodeClick/onEdgeClick below already write to.
  const selectIssue = (issue: Issue) => {
    if (issue.NodeID) {
      setSelectedNodeId(issue.NodeID)
      setSelectedEdgeId(null)
    } else if (issue.EdgeID) {
      setSelectedEdgeId(issue.EdgeID)
      setSelectedNodeId(null)
    }
  }
  const [draftLabel, setDraftLabel] = useState(initial.label)
  const [draftDescription, setDraftDescription] = useState(initial.description)
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

  // Hot exit (docs/goals/0012-authoring-hot-exit.md): the canvas store/
  // draftLabel/draftDescription are already seeded correctly from
  // `initial` above (computeInitialCanvas), so this hook only has to
  // surface the mount-time restore decision and keep a debounced
  // scratch write + live dirty flag in sync afterward -- see
  // useCanvasHotExit.ts's own doc comment for the full reasoning.
  useCanvasHotExit(tabKey, initial, nodes, edges, draftLabel, draftDescription)

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
      // A terminal node (docs/adr/0027) may have NO outgoing edge at
      // all -- checked before the out-degree-1 rule below, since "at
      // most 1" would otherwise let exactly one edge out of a Decision
      // through. Matches CanvasNodeView omitting its source handle
      // entirely; this is the draw-time layer of the same rule,
      // belt-and-suspenders with the missing handle.
      if (source?.data.kind === 'terminal') return false
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
        data: { nodeTypeID: nt.ID, kind: nt.Kind, label: nt.Label, output: nt.Output ?? '', config },
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
      Nodes: toDraftNodes(nodes),
      Edges: toDraftEdges(edges),
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
      // A successful Save is one of the two events that discard the
      // hot-exit scratch (docs/goals/0012) -- the draft it was shadowing
      // no longer exists as "unsaved." onSaved() (below) closes this
      // tab (app/WorkTabShell.tsx), which also prunes workTabDirty/
      // workTabRestored for tabKey -- this call only needs to handle
      // the localStorage side, which shared/store.ts can't reach (it's
      // a dependency-cruiser leaf and can't import composition/).
      clearScratch(tabKey)
      onSaved()
    } catch (err) {
      setSaveError(String(err))
    } finally {
      setSaving(false)
    }
  }

  useCanvasCommandDispatch(tabKey, save, runButtonRef)

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
          <Button size="small" onClick={save} disabled={saving} data-testid="save-workflow">
            {saving ? 'Saving…' : workflow ? 'Save changes' : 'Save workflow'}
          </Button>
          {/* Run is the canvas's one primary action once a workflow is
              saved (docs/SPEC.md §3.8) -- Save above is deliberately
              demoted off variant="primary" so the two don't compete. */}
          <RunButton ref={runButtonRef} workflow={workflow} onStartRun={startRun} />
        </Stack>
        {saveError && <Text as="p" size="small" className={runbookStyles.error}>{saveError}</Text>}
        {descOpen && (
          <FormControl className={styles.metaDescription}>
            <FormControl.Label>Description</FormControl.Label>
            <Textarea value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} rows={2} block />
          </FormControl>
        )}
      </div>

      <RunStateContext.Provider value={runStateContextValue}>
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
            // Cap fit-zoom at 100%: fitView's default happily zooms a
            // single starter node to fill the whole canvas, which read
            // as "zoomed in by default" (reported directly with a
            // screenshot) -- fit should frame the graph, never magnify
            // it past natural size.
            fitViewOptions={{ maxZoom: 1, padding: 0.25 }}
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
                <ValidationSurface issues={validationIssues} workflowLabel={draftLabel} onSelectIssue={selectIssue} />
                <Text size="small" className={runbookStyles.muted}>
                  Add steps to drag a node type onto the canvas, connect them, click a node to configure it.
                </Text>
              </Stack>
            </Panel>
            <CurrentStepBar barState={barState} onResolve={resolveApprovalStep} onDismiss={dismissRunState} />
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
              workflowId={workflow?.ID ?? ''}
              attrs={workflow?.Attributes ?? []}
              nodeType={selectedNodeType}
              sameKindNodeTypes={sameKindNodeTypes}
              hasWorkflow={!!workflow}
              hotkeyCapture={hotkeyCapture}
              onChangeType={(newType) => {
                const config: Record<string, string> = {}
                for (const field of newType.ConfigFields ?? []) config[field.Key] = field.Default
                changeNodeType(selectedNode.id, newType.ID, newType.Label, config, newType.Output ?? '')
              }}
              onConfigChange={(key, value) => updateNodeConfig(selectedNode.id, key, value)}
            />
          )}
        </div>
      </div>
      </RunStateContext.Provider>
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
