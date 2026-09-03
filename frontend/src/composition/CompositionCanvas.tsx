import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { ReactFlow, ReactFlowProvider, Background, Controls, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useStore } from 'zustand'
import type { NodeType, Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { createCanvasStore, type CanvasNode } from './canvasStore'
import { rfNodeTypes } from './rfNodeTypes'
import { findFreeDropPosition } from '../shared/canvasLayout'
import { CANVAS_NODE_WIDTH, CANVAS_NODE_HEIGHT } from './canvasConstants'
import { contractLine } from './payloadKinds'
import { useConnectionRefusalHint } from './useConnectionRefusalHint'
import { ConnectionRefusalHint } from './ConnectionRefusalHint'
import { useCanvasClipboard } from './useCanvasClipboard'
import { computeInitialCanvas, useCanvasHotExit } from './useCanvasHotExit'
import { useCanvasSave } from './useCanvasSave'
import { useCanvasLiveSync } from './useCanvasLiveSync'
import { useCanvasNotes } from './useCanvasNotes'
import { useCanvasAutoLayout } from './useCanvasAutoLayout'
import { NoteActionsContext } from './canvasNoteActions'
import { ExternalChangeBanner } from './ExternalChangeBanner'
import { CanvasMetaHeader } from './CanvasMetaHeader'
import { ThemedMiniMap } from '../shared/ThemedMiniMap'
import { useDraftValidation, groupIssuesByNode } from './useDraftValidation'
import { useBranchRuleActions } from './useBranchRuleActions'
import { useGuardrailBadges } from './useGuardrailBadges'
import { NodePalette } from './NodePalette'
import { CanvasToolbar } from './CanvasToolbar'
import { CanvasInspectorPanel } from './CanvasInspectorPanel'
import { CanvasSplit } from './CanvasSplit'
import { useTranslation } from 'react-i18next'
import { StepDetailOverlay } from './StepDetailOverlay'
import { ContextMenu } from '../shared/ContextMenu'
import { useCanvasContextMenuHandlers } from './useCanvasContextMenuHandlers'
import { useCanvasSelection } from './useCanvasSelection'
import { useHotkeyCapture } from './hotkeyCapture'
import { RunStateContext, useLiveRun } from './liveRunState'
import { BreakpointContext, useBreakpoints } from './breakpoints'
import { CurrentStepBar, type RunButtonHandle } from './LiveRunControls'
import { useCanvasCommandDispatch } from './useCanvasCommandDispatch'
import styles from './CompositionCanvas.module.css'
import { newLocalID } from '../shared/localId'
import { canvasNavigationProps, useCanvasNavigationMode } from '../shared/canvasNavigation'

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
  // A run to show on open -- an exact id or 'latest' (shared/workTabs.ts's
  // runId, goal 0294); the live-run bar and node marks come from it.
  requestedRunId?: string
  // The run monitor window (goal 0294 S2): canvas + run bar only -- no
  // meta header (label/description/offer/Edit) and no back button; the
  // window's own header and close are that chrome.
  viewer?: boolean
}

// A prototype canvas for SPEC.md §3 / ADR-0005 -- built ahead of B2's
// original "2+ real multi-step workflows exist" deferral trigger, by
// explicit decision (see the ADR's Update section). Composing a node
// always configures it (SPEC.md §3's locked principle): a dropped node
// gets its node type's default config immediately, editable via the
// Inspector the moment it's selected, never a bare unconfigured
// reference.
function CanvasInner({ nodeTypes, workflow, tabKey, onBack, onSaved, readOnly, onSwitchToEdit, requestedRunId, viewer }: CompositionCanvasProps) {
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
  const [useCanvasStore] = useState(() => createCanvasStore(initial.nodes, initial.edges, initial.notes))

  const [paletteOpen, setPaletteOpen] = useState(false)
  const canvasNavProps = canvasNavigationProps(useCanvasNavigationMode())

  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const notes = useCanvasStore((s) => s.notes)
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange)
  const onConnect = useCanvasStore((s) => s.onConnect)
  const addNode = useCanvasStore((s) => s.addNode)
  const changeNodeType = useCanvasStore((s) => s.changeNodeType)
  const updateNodeConfig = useCanvasStore((s) => s.updateNodeConfig)
  const updateEdgeCondition = useCanvasStore((s) => s.updateEdgeCondition)
  const removeSelected = useCanvasStore((s) => s.removeSelected)
  const removeNode = useCanvasStore((s) => s.removeNode)
  const removeEdge = useCanvasStore((s) => s.removeEdge)
  // Both are reactive re-derivations, not user edits -- canvasStore.ts's
  // own factory already wraps these two (and onNodesChange/
  // onEdgesChange/onNotesChange's bookkeeping-change subset) in
  // withHistoryPaused, so a plain selector here is enough (docs/goals/0174).
  const setGuardrailVerdicts = useCanvasStore((s) => s.setGuardrailVerdicts)
  const setValidationIssues = useCanvasStore((s) => s.setValidationIssues)

  // Notes (docs/goals/0055) render as a second React Flow node TYPE on
  // the same canvas -- see useCanvasNotes.ts's own header comment for
  // why this is a dedicated hook rather than inlined here.
  const { allNodes, handleNodesChange, addNoteNear, noteActions } = useCanvasNotes(useCanvasStore, nodes, notes, readOnly)

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
  const { detail: liveRunDetail, statusByNodeId: liveStepStatusByNodeId, barState, startRun, resolve: resolveApprovalStep, dismiss: dismissRunState } = useLiveRun(workflow?.ID, requestedRunId)

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

  const { screenToFlowPosition, zoomIn, zoomOut, fitView } = useReactFlow()

  // Selection/detail-overlay/context-menu cluster + the selected node's
  // derived Inspector data -- see useCanvasSelection.ts's own header.
  const {
    setSelectedNodeId, setSelectedEdgeId,
    detailOpen, setDetailOpen, contextMenu, setContextMenu, selectIssue,
    selectedNode, selectedNodeType, sameKindNodeTypes, selectedEdge, selectedEdgeFromDecision,
    handleChangeNodeType, handleNodeConfigChange,
  } = useCanvasSelection(nodes, edges, nodeTypes, changeNodeType, updateNodeConfig)
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
  const { layingOut, runAutoLayout } = useCanvasAutoLayout(useCanvasStore)

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
  useCanvasHotExit(tabKey, initial.restoredFromScratch, baseline, nodes, edges, notes, draftLabel, draftDescription, readOnly)

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

  // Draw-time refusal + its explanation (ADR-0042 slice 2) -- see useConnectionRefusalHint.ts.
  const { isValidConnection, refusalHint, flash, onConnectStart, onConnectEnd, onConnect: handleConnect, onNodeDragStart: handleNodeDragStart } = useConnectionRefusalHint(nodes, edges, nodeTypes, onConnect, () => useCanvasStore.temporal.getState().pause())
  useCanvasClipboard({ store: useCanvasStore, readOnly, screenToFlowPosition, flash })
  const branchRules = useBranchRuleActions(useCanvasStore, validationIssues, flash)

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
      const position = findFreeDropPosition(desired, nodes, { width: CANVAS_NODE_WIDTH, height: CANVAS_NODE_HEIGHT })
      const config: Record<string, string> = {}
      for (const field of nt.ConfigFields ?? []) config[field.Key] = field.Default
      const node: CanvasNode = {
        id: newLocalID(),
        type: nt.Kind,
        position,
        data: { nodeTypeID: nt.ID, kind: nt.Kind, label: nt.Label, output: nt.Output ?? '', contractLine: contractLine(nt), config },
      }
      addNode(node)
    },
    [nodeTypes, nodes, screenToFlowPosition, addNode, readOnly],
  )

  const { save, saving, saveError } = useCanvasSave(workflow, tabKey, readOnly, draftLabel, draftDescription, nodes, edges, notes, onSaved)

  useCanvasCommandDispatch(tabKey, save, runButtonRef, { useCanvasStore, removeSelected, zoomIn, zoomOut, fitView })

  const { onNodeContextMenu, onEdgeContextMenu, onPaneContextMenu } = useCanvasContextMenuHandlers({
    t, readOnly, removeNode, removeEdge, screenToFlowPosition, addNoteNear, setPaletteOpen,
    setSelectedNodeId, setSelectedEdgeId, setDetailOpen, setContextMenu,
  })

  return (
    <div className={styles.canvasSection} data-testid="composition-canvas">
      {pendingExternalChange && <ExternalChangeBanner onReload={reloadFromExternal} onKeep={keepDraft} />}
      {!viewer && (
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
      )}

      <RunStateContext.Provider value={runStateContextValue}>
      <BreakpointContext.Provider value={breakpoints}>
      <NoteActionsContext.Provider value={noteActions}>
      <div className={styles.canvasWrap}>
        {!readOnly && paletteOpen && <NodePalette nodeTypes={nodeTypes} hasTrigger={nodes.some((n) => n.data.kind === 'trigger')} />}
        <CanvasSplit hasSelection={!!selectedNode || !!selectedEdge} canvas={
        <div className={styles.canvas} onDrop={onCanvasDrop} onDragOver={(e) => e.preventDefault()}>
          <ReactFlow
            nodes={allNodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            isValidConnection={isValidConnection}
            nodeTypes={rfNodeTypes}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id)
              setSelectedEdgeId(null)
            }}
            // The step-detail overlay's other open affordance
            // (docs/goals/0058), alongside the sidebar's own expand
            // button -- skipped for a note (docs/goals/0055): a note
            // isn't a step, it has no detail to show, and its own
            // double-click already opens inline text editing
            // (CanvasNoteView.tsx), a separate handler by design.
            onNodeDoubleClick={(_, node) => {
              if (node.type === 'note') return
              setSelectedNodeId(node.id)
              setSelectedEdgeId(null)
              setDetailOpen(true)
            }}
            onNodeContextMenu={onNodeContextMenu}
            onEdgeContextMenu={onEdgeContextMenu}
            onPaneContextMenu={onPaneContextMenu}
            // React Flow's pane-level double-click-to-zoom (default true)
            // binds a native dblclick handler that stops propagation
            // before it can reach onNodeDoubleClick above -- off, since a
            // node double-click opens the step-detail overlay instead.
            zoomOnDoubleClick={false}
            // Scroll/pinch navigation is the user's declared mode (goal
            // 0257) -- the SAME bundle the Atlas board spreads, one
            // source so the two canvases can't drift.
            {...canvasNavProps}
            // React Flow's default minZoom (0.5) caps Fit View: a graph
            // wider than 2x the pane can never be fully brought into
            // view, leaving nodes unreachable on small windows. 0.1
            // lets Fit View always fit the whole workflow.
            minZoom={0.1}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id)
              setSelectedNodeId(null)
            }}
            onPaneClick={() => {
              setSelectedNodeId(null)
              setSelectedEdgeId(null)
            }}
            onNodeDragStart={handleNodeDragStart}
            onNodeDragStop={() => useCanvasStore.temporal.getState().resume()}
            // docs/goals/0022: draggability/connectability go inert in
            // view mode, but elementsSelectable stays true regardless
            // (see CompositionCanvasProps.readOnly's own comment) --
            // node click still needs to select+inspect. deleteKeyCode
            // needs an explicit null in view mode: React Flow's own
            // Backspace/Delete handling fires straight off node
            // selection state, independent of nodesDraggable/
            // nodesConnectable, so leaving it at its default would let
            // a selected node still be deleted by keyboard. The array
            // (not the library's own single-key 'Backspace' default)
            // is deliberate -- canvas.delete's hint advertises both
            // keys (shared/canvasCommands.ts), through this one
            // already-editable-target-guarded binding, never a second.
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
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
            <ConnectionRefusalHint hint={refusalHint} />
            <CanvasToolbar
              onBack={onBack}
              hideBack={viewer}
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
              onAddNote={() => addNoteNear(screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }))}
              validationIssues={validationIssues}
              workflowLabel={draftLabel}
              workflowId={workflow?.ID ?? ''}
              onSelectIssue={selectIssue}
            />
            <CurrentStepBar barState={barState} attrs={workflow?.Attributes ?? []} runDetail={liveRunDetail} onResolve={resolveApprovalStep} onDismiss={dismissRunState} />
          </ReactFlow>
        </div>
        } inspector={(headerActions) => (
        <CanvasInspectorPanel
          headerActions={headerActions}
          workflow={workflow}
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          selectedEdgeFromDecision={!!selectedEdgeFromDecision}
          selectedNodeType={selectedNodeType}
          sameKindNodeTypes={sameKindNodeTypes}
          hotkeyCapture={hotkeyCapture}
          readOnly={readOnly}
          runStep={selectedNode ? liveRunDetail?.steps?.find((s) => s.nodeID === selectedNode.id) : undefined}
          onOpenDetail={() => setDetailOpen(true)}
          onChangeType={handleChangeNodeType}
          onConfigChange={handleNodeConfigChange}
          onEdgeConditionChange={(edgeId, condition) => updateEdgeCondition(edgeId, condition)}
          edges={edges}
          {...branchRules}
        />
        )} />
      </div>
      </NoteActionsContext.Provider>
      </BreakpointContext.Provider>
      </RunStateContext.Provider>
      {detailOpen && selectedNode && (
        <StepDetailOverlay
          node={selectedNode}
          workflowId={workflow?.ID ?? ''}
          attrs={workflow?.Attributes ?? []}
          nodeType={selectedNodeType}
          sameKindNodeTypes={sameKindNodeTypes}
          hasWorkflow={!!workflow}
          hotkeyCapture={hotkeyCapture}
          readOnly={readOnly}
          onChangeType={handleChangeNodeType}
          onConfigChange={handleNodeConfigChange}
          onClose={() => setDetailOpen(false)}
        />
      )}
      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
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
