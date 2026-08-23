import { useTranslation } from 'react-i18next'
import { FormControl, IconButton, Stack, Text, TextInput } from '@primer/react'
import { GrabberIcon, TrashIcon } from '@primer/octicons-react'
import type { Edge as RFEdge } from '@xyflow/react'
import type { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { DecisionConditionEditor } from './DecisionConditionEditor'
import styles from './DecisionRulesPanel.module.css'

interface DecisionRuleRowProps {
  edge: RFEdge
  index: number
  attrs: AttributeDef[] | null | undefined
  errorMessage?: string
  readOnly: boolean
  isDragging: boolean
  isDragOver: boolean
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
  onConditionChange: (condition: string) => void
  onLabelChange: (label: string) => void
  onDelete: () => void
}

// One reorderable rule row in a Branch node's Rules panel
// (DecisionRulesPanel.tsx, docs/goals/0173) -- backed by a real,
// already-wired outgoing edge (source===this Decision node, condition
// !== "otherwise"). Dragging happens off the grabber handle only (not
// the whole row), matching NodePalette.tsx's own native-HTML5-drag
// convention -- the row itself is the drop target so a drag anywhere
// over it registers.
export function DecisionRuleRow({
  edge, index, attrs, errorMessage, readOnly, isDragging, isDragOver,
  onDragStart, onDragOver, onDrop, onDragEnd, onConditionChange, onLabelChange, onDelete,
}: DecisionRuleRowProps) {
  const { t } = useTranslation('composition')
  const condition = (edge.data as { condition?: string } | undefined)?.condition ?? ''
  const label = typeof edge.label === 'string' ? edge.label : ''

  return (
    <Stack
      direction="vertical"
      gap="condensed"
      className={`${styles.row} ${isDragOver ? styles.rowDragOver : ''} ${isDragging ? styles.rowDragging : ''}`}
      data-testid="decision-rule-row"
      data-edge-id={edge.id}
      onDragOver={(e) => {
        e.preventDefault()
        onDragOver()
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDrop()
      }}
    >
      <Stack direction="horizontal" justify="space-between" align="center">
        <Stack direction="horizontal" gap="condensed" align="center">
          <span
            className={styles.grabber}
            role="button"
            tabIndex={readOnly ? -1 : 0}
            aria-label={t('decisionRulesPanel.dragHandleAriaLabel', { n: index })}
            data-testid="decision-rule-drag-handle"
            draggable={!readOnly}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', edge.id)
              onDragStart()
            }}
            onDragEnd={onDragEnd}
          >
            <GrabberIcon size={12} />
          </span>
          <Text size="small" weight="semibold">{t('decisionRulesPanel.ruleN', { n: index })}</Text>
        </Stack>
        <IconButton
          icon={TrashIcon}
          aria-label={t('decisionRulesPanel.deleteRuleAriaLabel', { n: index })}
          size="small"
          variant="invisible"
          data-testid="decision-rule-delete"
          disabled={readOnly}
          onClick={onDelete}
        />
      </Stack>
      <FormControl disabled={readOnly}>
        <FormControl.Label>{t('decisionRulesPanel.labelFieldLabel')}</FormControl.Label>
        <TextInput
          size="small"
          block
          value={label}
          data-testid="decision-rule-label"
          onChange={(e) => onLabelChange(e.target.value)}
        />
      </FormControl>
      <DecisionConditionEditor attrs={attrs} condition={condition} onApply={onConditionChange} errorMessage={errorMessage} />
    </Stack>
  )
}
