import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Issue } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { CanvasStore } from './canvasStore'
import { groupIssuesByEdge } from './useDraftValidation'
import type { BranchRulesActions } from './DecisionRulesPanel'

// The Branch node's Rules panel (docs/goals/0173) -- grouped into one
// BranchRulesActions object so CanvasInspectorPanel/NodeInspector
// forward it as a single prop rather than six. Split out of
// CompositionCanvas.tsx (already at the 500-line convention,
// CLAUDE.md) the same way useConnectionRefusalHint.ts/
// useDraftValidation.ts already were. "Add rule" claims a pending slot
// (canvasStore's pendingRuleClaims) and reuses the same transient hint
// surface draw-time connection refusals already use, rather than a
// second notice mechanism.
export function useBranchRuleActions(useCanvasStore: CanvasStore, validationIssues: Issue[], flash: (message: string) => void) {
  const { t } = useTranslation('composition')
  const updateEdgeCondition = useCanvasStore((s) => s.updateEdgeCondition)
  const updateEdgeLabel = useCanvasStore((s) => s.updateEdgeLabel)
  const reorderDecisionEdges = useCanvasStore((s) => s.reorderDecisionEdges)
  const armPendingBranchRule = useCanvasStore((s) => s.armPendingBranchRule)
  const disarmPendingBranchRule = useCanvasStore((s) => s.disarmPendingBranchRule)
  const removeEdge = useCanvasStore((s) => s.removeEdge)
  const pendingRuleClaims = useCanvasStore((s) => s.pendingRuleClaims)

  const branchRuleActions: BranchRulesActions = useMemo(
    () => ({
      onConditionChange: updateEdgeCondition,
      onLabelChange: updateEdgeLabel,
      onDelete: removeEdge,
      onReorder: reorderDecisionEdges,
      onAddRule: (nodeId) => {
        armPendingBranchRule(nodeId)
        flash(t('decisionRulesPanel.pendingFlashHint'))
      },
      onCancelPending: disarmPendingBranchRule,
    }),
    [updateEdgeCondition, updateEdgeLabel, removeEdge, reorderDecisionEdges, armPendingBranchRule, disarmPendingBranchRule, flash, t],
  )
  const issuesByEdgeId = useMemo(() => groupIssuesByEdge(validationIssues), [validationIssues])

  return { branchRuleActions, issuesByEdgeId, pendingRuleClaims }
}
