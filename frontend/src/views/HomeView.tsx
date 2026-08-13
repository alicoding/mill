import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Checkbox, FormControl, Heading, SegmentedControl, Spinner, Stack, Text } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { GraphIcon } from '@primer/octicons-react'
import { ExecutionService, SettingsService } from '../shared/bindings'
import type { HomeMetrics } from '../shared/bindings'
import PageContainer from '../shared/PageContainer'
import { HomeMostUsed } from './HomeMostUsed'
import { formatMinutes } from './homeFormat'
import listStyles from '../shared/ListCard.module.css'
import styles from './HomeView.module.css'

// Home -- the value mirror (docs/goals/0014-home-dashboard.md,
// docs/SPEC.md §3.2.3): the reason to open Mill, not a monitoring
// afterthought. Everything on this page is a read model over already-
// local DBOS run history (ExecutionService.HomeMetrics) -- zero new
// telemetry, §1.1 untouched. Recharts (the ONE new npm dependency this
// goal adds) is lazy-imported below the fold, off the default mount
// path, so opening Home never pays its ~147KB gzip cost until the
// chart section actually renders.
const HomeChart = lazy(() => import('./HomeChart'))

type RangeDays = 7 | 30

function rangeToISO(days: RangeDays): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
}

export default function HomeView() {
  const { t } = useTranslation('views')
  const [rangeDays, setRangeDays] = useState<RangeDays>(7)
  // Error rate/Series default to triggered-only (n8n's manual-exclusion
  // convention, docs/goals/0014) -- this is the "flag to include test"
  // the goal's own metric-semantics section names; Time Saved/Ambient
  // are unaffected by it, per HomeMetrics.IncludeTest's own doc comment.
  const [includeTest, setIncludeTest] = useState(false)
  const [metrics, setMetrics] = useState<HomeMetrics | null>(null)
  // Per-workflow minutes-saved OVERRIDES only (SettingsService's own
  // shape, settingsservice_minutessaved.go) -- a workflow absent here
  // is still on the default, applied client-side too
  // (HomeMostUsed.tsx's own DEFAULT_MINUTES_FALLBACK).
  const [minutesByWorkflow, setMinutesByWorkflow] = useState<Record<string, number>>({})

  const refresh = useCallback(() => {
    const { from, to } = rangeToISO(rangeDays)
    ExecutionService.HomeMetrics(from, to, includeTest).then(setMetrics).catch(console.error)
  }, [rangeDays, includeTest])

  useEffect(() => { refresh() }, [refresh])

  // goal 0017 P1-3: Home is "the reason to open Mill" (docs/SPEC.md
  // §3.2.3) -- it must show a run that happened while the window sat
  // open on this page (a headless trigger, an MCP-driven run_workflow)
  // without the owner having to switch away and back. metrics (and the
  // mostUsed list HomeMostUsed.tsx renders from it) are both derived
  // from this one refresh() call, so one subscription covers both.
  useEffect(() => {
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (entity === 'run') refresh()
    })
  }, [refresh])

  useEffect(() => {
    // The generated binding types this `{ [_ in string]?: number }` (an
    // optional index signature, mirroring Go's map[string]int, which
    // never actually carries an explicit-undefined entry) -- cast back
    // to the plain Record every value here is guaranteed to be.
    SettingsService.ListWorkflowMinutesSaved()
      .then((m) => setMinutesByWorkflow((m ?? {}) as Record<string, number>))
      .catch(console.error)
  }, [])

  const handleMinutesChanged = useCallback((workflowId: string, minutes: number) => {
    setMinutesByWorkflow((prev) => ({ ...prev, [workflowId]: minutes }))
    // Time Saved itself only credits Success + RunKind:triggered runs
    // server-side (docs/goals/0014's locked semantics, executionservice_
    // home.go) -- refetch so an edited estimate that actually changes
    // that KPI (a workflow with real ambient history) reflects
    // immediately, not just the most-used row's own client-computed
    // preview total.
    refresh()
  }, [refresh])

  if (!metrics) {
    return (
      <PageContainer variant="wide" data-testid="home-view">
        {/* Design-wave-1 fix #6: the sidebar nav row already names this
            page ("Home") -- the h1 no longer repeats that label, it IS
            the descriptive subtitle (promoted to the top, at a smaller
            heading weight than the removed giant duplicate), so an
            aria-level heading still exists for a11y. */}
        <Heading as="h1" variant="medium">{t('home.subtitle')}</Heading>
        <Spinner />
      </PageContainer>
    )
  }

  const hasAnyRuns = metrics.mostUsed !== null && metrics.mostUsed.length > 0

  return (
    <PageContainer variant="wide" data-testid="home-view">
      <Stack direction="horizontal" justify="space-between" align="center" className={styles.header}>
        <div>
          <Heading as="h1" variant="medium" className={listStyles.muted}>
            {t('home.subtitle')}
          </Heading>
        </div>
        <SegmentedControl
          aria-label={t('home.timeRangeAriaLabel')}
          size="small"
          onChange={(i) => setRangeDays(i === 0 ? 7 : 30)}
        >
          <SegmentedControl.Button selected={rangeDays === 7}>{t('home.last7Days')}</SegmentedControl.Button>
          <SegmentedControl.Button selected={rangeDays === 30}>{t('home.last30Days')}</SegmentedControl.Button>
        </SegmentedControl>
      </Stack>

      {!hasAnyRuns ? (
        <Blankslate>
          <Blankslate.Visual>
            <GraphIcon size={32} />
          </Blankslate.Visual>
          <Blankslate.Heading>{t('home.noRunsBlankslateHeading')}</Blankslate.Heading>
          <Blankslate.Description>
            {t('home.noRunsBlankslateDescription')}
          </Blankslate.Description>
        </Blankslate>
      ) : (
        <>
          <div className={styles.kpiRow} data-testid="home-kpi-row">
            <TimeSavedCard timeSaved={metrics.timeSaved} />
            <ErrorRateCard errorRate={metrics.errorRate} includeTest={includeTest} onIncludeTestChange={setIncludeTest} />
            <AmbientCard ambient={metrics.ambient} />
          </div>

          <section className={styles.section}>
            <Heading as="h2" variant="small">{t('home.volumeErrorHeading')}</Heading>
            <Text as="p" size="small" className={listStyles.muted}>
              {t('home.volumeErrorDescription')}
            </Text>
            <Suspense fallback={<Spinner />}>
              <HomeChart series={metrics.series ?? []} />
            </Suspense>
          </section>

          <section className={styles.section}>
            <Heading as="h2" variant="small">{t('home.mostUsedHeading')}</Heading>
            <Text as="p" size="small" className={listStyles.muted}>
              {t('home.mostUsedDescription')}
            </Text>
            <HomeMostUsed
              usage={metrics.mostUsed ?? []}
              minutesByWorkflow={minutesByWorkflow}
              onMinutesChanged={handleMinutesChanged}
            />
          </section>
        </>
      )}
    </PageContainer>
  )
}

function TimeSavedCard({ timeSaved }: { timeSaved: HomeMetrics['timeSaved'] }) {
  const { t } = useTranslation('views')
  const byWorkflow = timeSaved.byWorkflow ?? []
  return (
    <div className={`${listStyles.card} ${styles.kpiCard}`} data-testid="kpi-time-saved">
      <Text as="p" size="small" className={listStyles.muted}>{t('home.timeSaved')}</Text>
      <Text as="p" className={styles.kpiValue}>{formatMinutes(t, timeSaved.totalMinutes)}</Text>
      {byWorkflow.length === 0 ? (
        <Text as="p" size="small" className={listStyles.muted} data-testid="time-saved-formula">
          {t('home.noAmbientRuns')}
        </Text>
      ) : (
        <Stack direction="vertical" gap="none" data-testid="time-saved-formula">
          {byWorkflow.map((w) => (
            <Text as="p" size="small" className={listStyles.muted} key={w.workflowID}>
              {t('home.timeSavedFormula', { label: w.workflowLabel, count: w.runCount, plural: w.runCount === 1 ? '' : 's', perRun: w.minutesPerRun, total: formatMinutes(t, w.totalMinutes) })}
            </Text>
          ))}
        </Stack>
      )}
    </div>
  )
}

function ErrorRateCard({ errorRate, includeTest, onIncludeTestChange }: {
  errorRate: HomeMetrics['errorRate']
  includeTest: boolean
  onIncludeTestChange: (v: boolean) => void
}) {
  const { t } = useTranslation('views')
  return (
    <div className={`${listStyles.card} ${styles.kpiCard}`} data-testid="kpi-error-rate">
      <Text as="p" size="small" className={listStyles.muted}>{t('home.errorRate')}</Text>
      <Text as="p" className={styles.kpiValue}>
        {errorRate.ratePercent == null ? '—' : `${errorRate.ratePercent.toFixed(0)}%`}
      </Text>
      <Text as="p" size="small" className={listStyles.muted} data-testid="error-rate-volume">
        {errorRate.totalTerminal === 0
          ? t('home.noFinishedRuns')
          : t('home.errorRateVolume', { errorCount: errorRate.errorCount, total: errorRate.totalTerminal })}
      </Text>
      <FormControl>
        <Checkbox
          checked={includeTest}
          onChange={(e) => onIncludeTestChange(e.target.checked)}
          data-testid="include-test-runs-checkbox"
        />
        <FormControl.Label>{t('home.includeManualTestRuns')}</FormControl.Label>
      </FormControl>
    </div>
  )
}

function AmbientCard({ ambient }: { ambient: HomeMetrics['ambient'] }) {
  const { t } = useTranslation('views')
  const total = ambient.triggeredCount + ambient.manualCount
  return (
    <div className={`${listStyles.card} ${styles.kpiCard}`} data-testid="kpi-ambient">
      <Text as="p" size="small" className={listStyles.muted}>{t('home.ambientVsManual')}</Text>
      <Text as="p" className={styles.kpiValue}>
        {ambient.ambientPercent == null ? '—' : `${ambient.ambientPercent.toFixed(0)}%`}
      </Text>
      <Text as="p" size="small" className={listStyles.muted}>
        {total === 0
          ? t('home.noRunsInRangeShort')
          : t('home.ambientBreakdown', { triggered: ambient.triggeredCount, manual: ambient.manualCount })}
      </Text>
    </div>
  )
}
