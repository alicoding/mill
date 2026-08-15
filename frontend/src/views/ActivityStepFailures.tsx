import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Heading, Text } from '@primer/react'
import { DataTable, type Column, Blankslate } from '@primer/react/experimental'
import { AlertIcon } from '@primer/octicons-react'
import { ExecutionService } from '../shared/bindings'
import type { StepFailureCount } from '../shared/bindings'
import styles from '../shared/ListCard.module.css'

// Goal 0051 item 3 (Power Automate's own "which connector fails most"
// class): a cross-workflow view of recent failures grouped by step
// type, derived from the same durable run history Activity's own
// per-workflow explorer reads, not the session-only live feed above it
// (ExecutionService.StepFailureBreakdown walks per-step data Home's
// own aggregate query never fetches). Subscribes to the same
// mill-data-changed 'run' event every other run-derived surface on
// this page does, so a run finishing while this page is open updates
// it without a manual refresh.
export function ActivityStepFailures() {
  const { t } = useTranslation('views')
  const [breakdown, setBreakdown] = useState<StepFailureCount[] | null>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(() => {
    ExecutionService.StepFailureBreakdown()
      .then((list) => setBreakdown(list ?? []))
      .catch((err) => setError(String(err)))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (entity === 'run') refresh()
    })
  }, [refresh])

  if (error) {
    return <Text as="p" size="small" className={styles.error}>{error}</Text>
  }
  if (breakdown === null) {
    return null
  }

  const columns: Column<StepFailureCount & { id: string }>[] = [
    {
      id: 'stepType', header: t('activityView.stepFailures.columns.stepType'), width: 'grow',
      renderCell: (row) => <Text size="small">{row.nodeTypeLabel}</Text>,
    },
    {
      id: 'failureCount', header: t('activityView.stepFailures.columns.failureCount'), width: 'auto',
      renderCell: (row) => <Text size="small">{row.failureCount}</Text>,
    },
  ]

  return (
    <section data-testid="activity-step-failures">
      <Heading as="h2" variant="small" className={styles.sectionHeading}>{t('activityView.stepFailures.heading')}</Heading>
      <Text as="p" size="small" className={styles.muted}>
        {t('activityView.stepFailures.description')}
      </Text>
      {breakdown.length === 0 ? (
        <Blankslate data-testid="activity-step-failures-empty">
          <Blankslate.Visual>
            <AlertIcon size={32} />
          </Blankslate.Visual>
          <Blankslate.Heading>{t('activityView.stepFailures.noFailuresHeading')}</Blankslate.Heading>
          <Blankslate.Description>{t('activityView.stepFailures.noFailuresDescription')}</Blankslate.Description>
        </Blankslate>
      ) : (
        <DataTable
          aria-label={t('activityView.stepFailures.heading')}
          data={breakdown.map((row) => ({ ...row, id: row.nodeTypeID }))}
          columns={columns}
          cellPadding="condensed"
        />
      )}
    </section>
  )
}
