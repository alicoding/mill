import type { ReactNode } from 'react'
import type { Edge as RFEdge } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { Text } from '@primer/react'
import type { NodeType, Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { RunStep } from '../shared/bindings'
import type { CanvasNode } from './canvasStore'
import { DecisionEdgeInspector } from './DecisionEdgeInspector'
import { NodeInspector } from './NodeInspector'
import type { BranchRulesActions } from './DecisionRulesPanel'
import { useHotkeyCapture } from './hotkeyCapture'
import styles from './CompositionCanvas.module.css'

interface CanvasInspectorPanelProps {
  headerActions?: ReactNode
  workflow: Workflow | null | undefined
  selectedNode: CanvasNode | null
  selectedEdge: RFEdge | null
  selectedEdgeFromDecision: boolean
  selectedNodeType: NodeType | undefined
  sameKindNodeTypes: NodeType[]
  hotkeyCapture: ReturnType<typeof useHotkeyCapture>
  readOnly: boolean
  runStep: RunStep | undefined
  onOpenDetail: () => void
  // Bound to the selected node/edge by the caller (CompositionCanvas.tsx)
  // -- both this panel and StepDetailOverlay need the identical two
  // callbacks for the identical selected node, so the id-to-store-call
  // binding lives once in the caller instead of twice here.
  onChangeType: (newType: NodeType) => void
  onConfigChange: (key: string, value: string) => void
  onEdgeConditionChange: (edgeId: string, condition: string) => void
  // Branch node's Rules panel (docs/goals/0173) -- forwarded straight
  // through to NodeInspector, see its own doc comment.
  edges: RFEdge[]
  pendingRuleClaims: Record<string, number>
  issuesByEdgeId: Record<string, string>
  branchRuleActions: BranchRulesActions
}

// The canvas's right-side inspector column -- extracted out of
// CompositionCanvas.tsx once wiring the step-detail overlay's open
// affordance (docs/goals/0058) pushed that file over the 500-line
// convention (CLAUDE.md). Unchanged in behavior from its previous
// inline form: an edge-selected branch (DecisionEdgeInspector), a
// node-selected branch (NodeInspector), or the empty prompt when
// neither is selected.
export function CanvasInspectorPanel({ headerActions, workflow, selectedNode, selectedEdge, selectedEdgeFromDecision, selectedNodeType, sameKindNodeTypes, hotkeyCapture, readOnly, runStep, onOpenDetail, onChangeType, onConfigChange, onEdgeConditionChange, edges, pendingRuleClaims, issuesByEdgeId, branchRuleActions }: CanvasInspectorPanelProps) {
  const { t } = useTranslation('composition')
  return (
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
          onApply={(condition) => onEdgeConditionChange(selectedEdge.id, condition)}
        />
      )}
      {selectedNode && (
        <NodeInspector
          key={selectedNode.id}
          node={selectedNode}
          headerActions={headerActions}
          workflowId={workflow?.ID ?? ''}
          attrs={workflow?.Attributes ?? []}
          nodeType={selectedNodeType}
          sameKindNodeTypes={sameKindNodeTypes}
          hasWorkflow={!!workflow}
          hotkeyCapture={hotkeyCapture}
          runStep={runStep}
          readOnly={readOnly}
          onOpenDetail={onOpenDetail}
          onChangeType={onChangeType}
          onConfigChange={onConfigChange}
          edges={edges}
          pendingRuleCount={pendingRuleClaims[selectedNode.id] ?? 0}
          issuesByEdgeId={issuesByEdgeId}
          branchRuleActions={branchRuleActions}
        />
      )}
    </div>
  )
}
