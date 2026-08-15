import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SegmentedControl, Stack, Text } from '@primer/react'
import { isJsonLike, formatJson } from './stepDetailJson'
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
}

// One side of the step-detail overlay's data columns (docs/goals/0058):
// a recorded payload, its attributes if any, and a Text/JSON toggle
// when the payload parses as a JSON object/array. INPUT and OUTPUT both
// render through this same component -- the difference is only which
// side of the RunStep they're handed.
export function StepDetailDataPane({ heading, payload, attributes, emptyMessage, testId }: StepDetailDataPaneProps) {
  const { t } = useTranslation('composition')
  const [view, setView] = useState<'text' | 'json'>('text')
  const hasAttrs = !!attributes && Object.keys(attributes).length > 0
  const hasPayload = !!payload
  const jsonCapable = hasPayload && isJsonLike(payload)

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
      <Stack direction="horizontal" justify="space-between" align="center">
        <Text size="small" weight="semibold">{heading}</Text>
        {jsonCapable && (
          <SegmentedControl aria-label={t('stepDetailOverlay.viewToggleAriaLabel', { pane: heading })} size="small"
            onChange={(index) => setView(index === 0 ? 'text' : 'json')}>
            <SegmentedControl.Button selected={view === 'text'}>{t('stepDetailOverlay.textView')}</SegmentedControl.Button>
            <SegmentedControl.Button selected={view === 'json'}>{t('stepDetailOverlay.jsonView')}</SegmentedControl.Button>
          </SegmentedControl>
        )}
      </Stack>
      {hasPayload && (
        <pre className={styles.result} data-testid={`${testId}-payload`}>
          {view === 'json' && jsonCapable ? formatJson(payload) : payload}
        </pre>
      )}
      {hasAttrs && (
        <>
          <Text size="small" className={styles.muted}>{t('stepDetailOverlay.attributes')}</Text>
          <pre className={styles.result} data-testid={`${testId}-attrs`}>{JSON.stringify(attributes, null, 2)}</pre>
        </>
      )}
    </Stack>
  )
}
