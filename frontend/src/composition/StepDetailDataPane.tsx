import { useTranslation } from 'react-i18next'
import { Stack, Text } from '@primer/react'
import { OutputViewer } from '../shared/OutputViewer'
import type { OutputShape } from '../shared/outputShape'
import styles from '../shared/ListCard.module.css'

interface StepDetailDataPaneProps {
  heading: string
  payload: string
  attributes?: { [key: string]: unknown } | null
  // "Run this workflow to see real data here" (docs/goals/0058 item 4) --
  // shown when this step has neither a recorded payload nor attributes,
  // whether because no run exists yet or this step never executed on
  // the latest one.
  emptyMessage: string
  testId: string
  // The producing step's declared payload kind (ADR-0042) where the
  // caller knows it; absent leaves the shape to the viewer's own
  // structural inference.
  shape?: OutputShape
}

// One side of the step-detail overlay's data columns (docs/goals/0058):
// a recorded payload and its attributes, each through the shared output
// viewer (goal 0326) -- which owns the view switch, Find, Copy and the
// render budget, so this pane no longer carries a toggle of its own.
// INPUT and OUTPUT both render through this same component; the
// difference is only which side of the RunStep they're handed.
export function StepDetailDataPane({ heading, payload, attributes, emptyMessage, testId, shape }: StepDetailDataPaneProps) {
  const { t } = useTranslation('composition')
  const hasAttrs = !!attributes && Object.keys(attributes).length > 0
  const hasPayload = !!payload

  if (!hasPayload && !hasAttrs) {
    return (
      <Stack direction="vertical" gap="condensed" data-testid={testId}>
        <Text size="small" weight="semibold">{heading}</Text>
        <Text size="small" className={styles.muted}>{emptyMessage}</Text>
      </Stack>
    )
  }

  return (
    <Stack direction="vertical" gap="condensed" data-testid={testId}>
      <Text size="small" weight="semibold">{heading}</Text>
      {hasPayload && (
        <OutputViewer value={payload} shape={shape} title={heading} site={`${testId}-payload`} testId={`${testId}-payload`} />
      )}
      {hasAttrs && (
        <>
          <Text size="small" className={styles.muted}>{t('stepDetailOverlay.attributes')}</Text>
          <OutputViewer value={attributes} shape="json" title={t('stepDetailOverlay.attributes')} site={`${testId}-attrs`} testId={`${testId}-attrs`} />
        </>
      )}
    </Stack>
  )
}
