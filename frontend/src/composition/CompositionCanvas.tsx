import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
} from '@xyflow/react'
import type { Connection, Edge as RFEdge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useStore } from 'zustand'
import { useTranslation } from 'react-i18next'
import { Text } from '@primer/react'
import type { NodeType, Workflow, Issue } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { createCanvasStore, type CanvasNode } from './canvasStore'
import { rfNodeTypes } from './rfNodeTypes'
import { CANVAS_NODE_WIDTH, CANVAS_NODE_HEIGHT } from './canvasConstants'
import { findFreeDropPosition } from './canvasLayout'
import { computeInitialCanvas, useCanvasHotExit } from './useCanvasHotExit'
import { useCanvasSave } from './useCanvasSave'
import { useCanvasLiveSync } from './useCanvasLiveSync'
import { ExternalChangeBanner } from './ExternalChangeBanner'
import { CanvasMetaHeader } from './CanvasMetaHeader'
import { ThemedMiniMap } from './ThemedMiniMap'
import { useDraftValidation, groupIssuesByNode } from './useDraftValidation'
import { useGuardrailBadges } from './useGuardrailBadges'
import { NodePalette } from './NodePalette'
import { CanvasToolbar } from './CanvasToolbar'
import { DecisionEdgeInspector } from './DecisionEdgeInspector'
import { NodeInspector } from './NodeInspector'
import { useHotkeyCapture } from './hotkeyCapture'
import { RunStateContext, useLiveRun } from './liveRunState'
import { BreakpointContext, useBreakpoints } from './breakpoints'
import { CurrentStepBar, type RunButtonHandle } from './LiveRunControls'
import { useCanvasCommandDispatch } from './useCanvasCommandDispatch'
import styles from './CompositionCanvas.module.css'

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
  // docs/goals/0022-workflow-view-mode.md: renders this SAME mounted
  // canvas read-only in place (no remount) -- React Flow's own
  // nodesDraggable/nodesConnectable/deleteKeyCode go inert, the
  // authoring toolbar (palette/undo/redo/auto-layout/delete-selected)
  // disappears, and NodeInspector wraps its fields in a disabled
  // <fieldset>. elementsSelectable deliberately stays ON regardless
  // (see the ReactFlow props below) -- selecting a node to read its
  // config in the Inspector is inspection, not a mutation, and
  // WorkflowHoverPreview.tsx's own elementsSelectable={false} is a
  // fundamentally different case (a non-interactive glance thumbnail,
  // never meant to be clicked into).
  readOnly: boolean
  // Switches THIS tab from view to edit in place (store.ts's
  // setWorkTabMode) -- CanvasMetaHeader's own Edit button.
  onSwitchToEdit?: () => void
}

// A prototype canvas for SPEC.md §3 / ADR-0005 -- built ahead of B2's
// original "2+ real multi-step workflows exist" deferral trigger, by
// explicit decision (see the ADR's Update section). Composing a node
// always configures it (SPEC.md §3's locked principle): a dropped node
// gets its node type's default config immediately, editable via the
// Inspector the moment it's selected, never a bare unconfigured
// reference.
function CanvasInner({ nodeTypes, workflow, tabKey, onBack, onSaved, readOnly, onSwitchToEdit }: CompositionCanvasProps) {
  const { t } = useTranslation('composition')
  // Computed once, synchronously, at first render -- see
  // computeInitialCanvas's own doc comment for why this isn't a
  // useEffect. `initial.baseline` (docs/goals/0012) is what every later
  // dirty check compares the live draft against: the saved workflow's
  // real content (or the empty-starter content for a new workflow),
  // never the restored scratch itself -- so a restored-but-unedited-
  // since-restore canvas still reads as dirty until an actual Save.
  // `readOnly` is captured at its MOUNT-time value here (a lazy
  // initializer runs once) -- see computeInitialCanvas's own doc
  // comment on why a later view->edit switch deliberately doesn't
  // retroactively re-check for a scratch.
  const [initial] = useState(() => computeInitialCanvas(workflow, nodeTypes, tabKey, readOnly))

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

  // Nothing-hidden guardrail badges (docs/adr/0022's Update, extended by
  // docs/adr/0031's breakpoint toggle) -- see useGuardrailBadges.ts's
  // own header comment for the full design.
  const refreshGuardrailVerdicts = useGuardrailBadges(workflow?.ID, nodes, setGuardrailVerdicts)

  // Ground-truth breakpoint state (docs/adr/0031, goal 0022's move onto
  // the node card itself) -- provided via context so every card can
  // read/toggle its own without a per-node fetch; refreshGuardrailVerdicts
  // is passed as onChanged so a toggle also refreshes the shield badges
  // above (breakpoints.ts's own header comment explains why the two are
  // separate fetches that both need refreshing on a toggle).
  const breakpoints = useBreakpoints(workflow?.ID, refreshGuardrailVerdicts)

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
  const [layingOut, setLayingOut] = useState(false)

  // What every dirty check (hot exit, live sync) compares the live
  // draft against -- starts as the saved workflow's real content
  // (initial.baseline), but is NOT frozen there: a clean external
  // reload (useCanvasLiveSync below) advances it to the newly-loaded
  // content, so a canvas that was clean before an external MCP edit
  // stays clean (no false "dirty" scratch write) after adopting it.
  const [baseline, setBaseline] = useState(initial.baseline)

  // Hot exit (docs/goals/0012-authoring-hot-exit.md): the canvas store/
  // draftLabel/draftDescription are already seeded correctly from
  // `initial` above (computeInitialCanvas), so this hook only has to
  // surface the mount-time restore decision and keep a debounced
  // scratch write + live dirty flag in sync afterward -- see
  // useCanvasHotExit.ts's own doc comment for the full reasoning.
  useCanvasHotExit(tabKey, initial.restoredFromScratch, baseline, nodes, edges, draftLabel, draftDescription, readOnly)

  // Live sync (GAP B): an external MCP write to THIS workflow while the
  // editor is open redraws the canvas immediately when clean, or offers
  // a Reload/Keep-my-draft choice when dirty -- see
  // useCanvasLiveSync.ts's own doc comment.
  const { pendingExternalChange, reloadFromExternal, keepDraft } = useCanvasLiveSync({
    workflowId: workflow?.ID,
    nodeTypes,
    useCanvasStore,
    baseline,
    setBaseline,
    draftLabel,
    draftDescription,
    setDraftLabel,
    setDraftDescription,
  })

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
      // Defensive: the palette that's the only real drag SOURCE for
      // this handler is already absent in read-only mode (gated below),
      // but a stray OS-level drag event (e.g. dragging a file over the
      // canvas) could still reach onDrop -- belt-and-suspenders against
      // mutating a read-only canvas's store.
      if (readOnly) return
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
    [nodeTypes, nodes, screenToFlowPosition, addNode, readOnly],
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

  const { save, saving, saveError } = useCanvasSave(workflow, tabKey, readOnly, draftLabel, draftDescription, nodes, edges, onSaved)

  useCanvasCommandDispatch(tabKey, save, runButtonRef)

  return (
    <div className={styles.canvasSection} data-testid="composition-canvas">
      {pendingExternalChange && <ExternalChangeBanner onReload={reloadFromExternal} onKeep={keepDraft} />}
      <CanvasMetaHeader
        workflow={workflow}
        draftLabel={draftLabel}
        onLabelChange={setDraftLabel}
        descOpen={descOpen}
        onToggleDesc={() => setDescOpen((v) => !v)}
        draftDescription={draftDescription}
        onDescriptionChange={setDraftDescription}
        save={save}
        saving={saving}
        saveError={saveError}
        runButtonRef={runButtonRef}
        onStartRun={startRun}
        readOnly={readOnly}
        onSwitchToEdit={onSwitchToEdit}
      />

      <RunStateContext.Provider value={runStateContextValue}>
      <BreakpointContext.Provider value={breakpoints}>
      <div className={styles.canvasWrap}>
        {!readOnly && paletteOpen && <NodePalette nodeTypes={nodeTypes} hasTrigger={nodes.some((n) => n.data.kind === 'trigger')} />}
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
            // docs/goals/0022: draggability/connectability go inert in
            // view mode, but elementsSelectable stays true regardless
            // (see CompositionCanvasProps.readOnly's own comment) --
            // node click still needs to select+inspect. deleteKeyCode
            // needs an explicit null in view mode: React Flow's own
            // Backspace/Delete handling fires straight off node
            // selection state, independent of nodesDraggable/
            // nodesConnectable, so leaving it at its default would let
            // a selected node still be deleted by keyboard.
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            deleteKeyCode={readOnly ? null : undefined}
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
            <ThemedMiniMap />
            <CanvasToolbar
              onBack={onBack}
              readOnly={readOnly}
              paletteOpen={paletteOpen}
              onTogglePalette={() => setPaletteOpen((v) => !v)}
              canUndo={canUndo}
              onUndo={() => useCanvasStore.temporal.getState().undo()}
              canRedo={canRedo}
              onRedo={() => useCanvasStore.temporal.getState().redo()}
              layingOut={layingOut}
              hasNodes={nodes.length > 0}
              onAutoLayout={runAutoLayout}
              onDeleteSelected={removeSelected}
              validationIssues={validationIssues}
              workflowLabel={draftLabel}
              workflowId={workflow?.ID ?? ''}
              onSelectIssue={selectIssue}
            />
            <CurrentStepBar barState={barState} attrs={workflow?.Attributes ?? []} onResolve={resolveApprovalStep} onDismiss={dismissRunState} />
          </ReactFlow>
        </div>

        <div
          className={`${styles.inspector} ${!selectedNode && !selectedEdge ? styles.inspectorCollapsed : ''}`}
          data-testid="composition-inspector"
        >
          {!selectedNode && !selectedEdgeFromDecision && (
            <Text className={styles.inspectorEmpty} size="small">
              {selectedEdge ? t('compositionCanvas.onlyDecisionEdgesConfigurable') : t('compositionCanvas.selectNodeToConfigure')}
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
              runStep={liveRunDetail?.steps?.find((s) => s.nodeID === selectedNode.id)}
              readOnly={readOnly}
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
      </BreakpointContext.Provider>
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
