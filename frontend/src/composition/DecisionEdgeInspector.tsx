import { useTranslation } from 'react-i18next'
import { Checkbox, Stack, Text } from '@primer/react'
import type { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { DecisionConditionEditor } from './DecisionConditionEditor'
import { OTHERWISE_HANDLE } from './ruleTranslate'
import runbookStyles from '../shared/ListCard.module.css'

interface DecisionEdgeInspectorProps {
  edgeId: string
  condition: string
  attrs: AttributeDef[] | null | undefined
  onApply: (condition: string) => void
}

// Shown in the Inspector when a Decision node's outgoing edge is
// selected directly on the canvas (CompositionCanvas.tsx's onEdgeClick)
// -- lets a user either mark the edge as the required "otherwise"
// fallback (composition.go's otherwiseHandle, ValidateGraph requires
// exactly one per Decision node) or build a real expr-lang condition
// visually (DecisionConditionEditor). This surface stays exactly as it
// was before the Branch node grew its own Rules panel (docs/goals/0173,
// DecisionRulesPanel.tsx) -- an ADDITIONAL way in, not a replacement,
// so anyone who thinks in edges keeps working. The current condition is
// always shown as read-only text alongside the editor, since there is
// no reverse parser to pre-populate the visual builder from it (see
// DecisionConditionEditor's own doc comment).
export function DecisionEdgeInspector({ edgeId, condition, attrs, onApply }: DecisionEdgeInspectorProps) {
  const { t } = useTranslation('composition')
  const isOtherwise = condition === OTHERWISE_HANDLE

  return (
    <Stack direction="vertical" gap="condensed" key={edgeId}>
      <Text weight="semibold">{t('decisionEdgeInspector.heading')}</Text>
      <Text size="small" className={runbookStyles.muted}>
        {t('decisionEdgeInspector.currentConditionPrefix')} {condition ? <code>{condition}</code> : t('decisionEdgeInspector.notSet')}
      </Text>

      <Checkbox
        checked={isOtherwise}
        onChange={(e) => onApply(e.target.checked ? OTHERWISE_HANDLE : '')}
      />
      <Text size="small">{t('decisionEdgeInspector.fallbackCheckboxLabel')}</Text>

      {!isOtherwise && <DecisionConditionEditor attrs={attrs} condition={condition} onApply={onApply} />}
    </Stack>
  )
}
