import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton, Stack, Text } from '@primer/react'
import { PlusIcon, XIcon } from '@primer/octicons-react'
import type { Edge as RFEdge } from '@xyflow/react'
import type { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { OTHERWISE_HANDLE } from './ruleTranslate'
import { DecisionRuleRow } from './DecisionRuleRow'
import styles from './DecisionRulesPanel.module.css'

// One grouped bundle of the Rules panel's own mutation callbacks --
// passed through CanvasInspectorPanel/NodeInspector as a single prop
// rather than six, since neither intermediate layer does anything with
// them beyond forwarding (docs/goals/0173).
export interface BranchRulesActions {
  onConditionChange: (edgeId: string, condition: string) => void
  onLabelChange: (edgeId: string, label: string) => void
  onDelete: (edgeId: string) => void
  onReorder: (nodeId: string, orderedEdgeIds: string[]) => void
  onAddRule: (nodeId: string) => void
  onCancelPending: (nodeId: string) => void
}

interface DecisionRulesPanelProps extends BranchRulesActions {
  nodeId: string
  edges: RFEdge[]
  attrs: AttributeDef[] | null | undefined
  readOnly: boolean
  // Rules queued via "Add rule" whose edge hasn't been drawn yet (see
  // canvasStore's pendingRuleClaims doc comment).
  pendingCount: number
  // Save-time compile-rejection message per edge id (ValidateDraft's
  // Issue.Message, docs/goals/0173) -- shown inline on that edge's row.
  issuesByEdgeId: Record<string, string>
}

// The Branch node's own Rules panel (docs/goals/0173's DESIGN CONTRACT):
// one ordered list of every rule on this Decision node, in the exact
// order nextNode (graph.go) evaluates them, with a pinned non-draggable
// non-deletable Otherwise row always last. Each row is backed by a
// real, already-wired outgoing edge -- this panel only ever reads/
// reorders/edits `edges`, it never invents graph state of its own, so
// "each rule keeps its own visible, wireable canvas edge" holds by
// construction. Storage is unchanged: reordering rewrites the SAME
// Edge array's relative order (canvasStore's reorderDecisionEdges),
// never a new representation.
export function DecisionRulesPanel({
  nodeId, edges, attrs, readOnly, pendingCount, issuesByEdgeId,
  onConditionChange, onLabelChange, onDelete, onReorder, onAddRule, onCancelPending,
}: DecisionRulesPanelProps) {
  const { t } = useTranslation('composition')
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const nodeEdges = edges.filter((e) => e.source === nodeId)
  const otherwiseEdge = nodeEdges.find((e) => (e.data as { condition?: string } | undefined)?.condition === OTHERWISE_HANDLE)
  const ruleEdges = nodeEdges.filter((e) => e.id !== otherwiseEdge?.id)

  const handleDrop = (targetId: string) => {
    const ids = ruleEdges.map((e) => e.id)
    const from = dragId ? ids.indexOf(dragId) : -1
    const to = ids.indexOf(targetId)
    if (dragId && from !== -1 && to !== -1 && from !== to) {
      const next = [...ids]
      next.splice(from, 1)
      next.splice(to, 0, dragId)
      onReorder(nodeId, next)
    }
    setDragId(null)
    setOverId(null)
  }

  return (
    <Stack direction="vertical" gap="condensed" data-testid="decision-rules-panel">
      <Text weight="semibold">{t('decisionRulesPanel.heading')}</Text>
      <Text size="small" className={styles.pendingHint} data-testid="decision-rules-helper">
        {t('decisionRulesPanel.helper')}
      </Text>

      {ruleEdges.length === 0 && pendingCount === 0 && (
        <Text size="small" data-testid="decision-rules-empty">{t('decisionRulesPanel.emptyState')}</Text>
      )}

      {ruleEdges.map((edge, i) => (
        <DecisionRuleRow
          key={edge.id}
          edge={edge}
          index={i + 1}
          attrs={attrs}
          errorMessage={issuesByEdgeId[edge.id]}
          readOnly={readOnly}
          isDragging={dragId === edge.id}
          isDragOver={overId === edge.id && dragId !== edge.id}
          onDragStart={() => setDragId(edge.id)}
          onDragOver={() => setOverId(edge.id)}
          onDrop={() => handleDrop(edge.id)}
          onDragEnd={() => {
            setDragId(null)
            setOverId(null)
          }}
          onConditionChange={(condition) => onConditionChange(edge.id, condition)}
          onLabelChange={(label) => onLabelChange(edge.id, label)}
          onDelete={() => onDelete(edge.id)}
        />
      ))}

      {/* Pending stubs carry no identity of their own until an edge
          exists to back them, so the array position is the only key
          available -- there is never more than one re-order among these. */}
      {Array.from({ length: pendingCount }).map((_, i) => (
        <Stack key={`pending-${i}`} direction="horizontal" justify="space-between" align="center" data-testid="decision-rule-pending">
          <Text size="small" className={styles.pendingHint}>{t('decisionRulesPanel.pendingFlashHint')}</Text>
          <IconButton
            icon={XIcon}
            size="small"
            variant="invisible"
            aria-label={t('decisionRulesPanel.cancelPendingAriaLabel')}
            onClick={() => onCancelPending(nodeId)}
          />
        </Stack>
      ))}

      {!readOnly && (
        <div>
          <Button size="small" leadingVisual={PlusIcon} data-testid="decision-add-rule" onClick={() => onAddRule(nodeId)}>
            {t('decisionRulesPanel.addRule')}
          </Button>
        </div>
      )}

      <Stack direction="vertical" gap="condensed" className={styles.otherwiseRow} data-testid="decision-otherwise-row">
        <Text size="small" weight="semibold">{t('decisionRulesPanel.otherwiseLabel')}</Text>
        <Text size="small" className={styles.pendingHint}>{t('decisionRulesPanel.otherwiseHelper')}</Text>
        {!otherwiseEdge && (
          <Text size="small" className={styles.pendingHint} data-testid="decision-otherwise-unconnected">
            {t('decisionRulesPanel.notConnectedHint')}
          </Text>
        )}
      </Stack>
    </Stack>
  )
}
