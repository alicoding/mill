import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
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
        <Heading as="h1">Home</Heading>
        <Spinner />
      </PageContainer>
    )
  }

  const hasAnyRuns = metrics.mostUsed !== null && metrics.mostUsed.length > 0

  return (
    <PageContainer variant="wide" data-testid="home-view">
      <Stack direction="horizontal" justify="space-between" align="center" className={styles.header}>
        <div>
          <Heading as="h1">Home</Heading>
          <Text as="p" size="small" className={listStyles.muted}>
            Time saved, what ran, and what to learn from it — all from local run history. Nothing here ever leaves this machine.
          </Text>
        </div>
        <SegmentedControl
          aria-label="Time range"
          size="small"
          onChange={(i) => setRangeDays(i === 0 ? 7 : 30)}
        >
          <SegmentedControl.Button selected={rangeDays === 7}>Last 7 days</SegmentedControl.Button>
          <SegmentedControl.Button selected={rangeDays === 30}>Last 30 days</SegmentedControl.Button>
        </SegmentedControl>
      </Stack>

      {!hasAnyRuns ? (
        <Blankslate>
          <Blankslate.Visual>
            <GraphIcon size={32} />
          </Blankslate.Visual>
          <Blankslate.Heading>No runs yet in this range</Blankslate.Heading>
          <Blankslate.Description>
            Run or trigger a workflow and come back — Home fills in as soon as something runs.
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
            <Heading as="h2" variant="small">Volume &amp; error rate</Heading>
            <Text as="p" size="small" className={listStyles.muted}>
              Daily, in your local timezone. A day&apos;s error rate only shows once it has at least 3 finished runs —
              fewer than that and one failure would misleadingly read as 100%.
            </Text>
            <Suspense fallback={<Spinner />}>
              <HomeChart series={metrics.series ?? []} />
            </Suspense>
          </section>

          <section className={styles.section}>
            <Heading as="h2" variant="small">Most-used workflows</Heading>
            <Text as="p" size="small" className={listStyles.muted}>
              Every run counts here, however it fired. Editing a workflow&apos;s minutes-saved estimate feeds the Time
              saved figure above.
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
  const byWorkflow = timeSaved.byWorkflow ?? []
  return (
    <div className={`${listStyles.card} ${styles.kpiCard}`} data-testid="kpi-time-saved">
      <Text as="p" size="small" className={listStyles.muted}>Time saved</Text>
      <Text as="p" className={styles.kpiValue}>{formatMinutes(timeSaved.totalMinutes)}</Text>
      {byWorkflow.length === 0 ? (
        <Text as="p" size="small" className={listStyles.muted} data-testid="time-saved-formula">
          No ambient (triggered) runs yet in this range — a manual test run doesn&apos;t count as automation replacing
          your own work.
        </Text>
      ) : (
        <Stack direction="vertical" gap="none" data-testid="time-saved-formula">
          {byWorkflow.map((w) => (
            <Text as="p" size="small" className={listStyles.muted} key={w.workflowID}>
              {w.workflowLabel}: {w.runCount} run{w.runCount === 1 ? '' : 's'} × {w.minutesPerRun} min = {formatMinutes(w.totalMinutes)}
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
  return (
    <div className={`${listStyles.card} ${styles.kpiCard}`} data-testid="kpi-error-rate">
      <Text as="p" size="small" className={listStyles.muted}>Error rate</Text>
      <Text as="p" className={styles.kpiValue}>
        {errorRate.ratePercent == null ? '—' : `${errorRate.ratePercent.toFixed(0)}%`}
      </Text>
      <Text as="p" size="small" className={listStyles.muted} data-testid="error-rate-volume">
        {errorRate.totalTerminal === 0
          ? 'No finished runs yet in this range.'
          : `${errorRate.errorCount} of ${errorRate.totalTerminal} finished runs failed. A retry that eventually ` +
            'succeeded doesn’t count as a failure; parked and cancelled runs are excluded.'}
      </Text>
      <FormControl>
        <Checkbox
          checked={includeTest}
          onChange={(e) => onIncludeTestChange(e.target.checked)}
          data-testid="include-test-runs-checkbox"
        />
        <FormControl.Label>Include manual test runs</FormControl.Label>
      </FormControl>
    </div>
  )
}

function AmbientCard({ ambient }: { ambient: HomeMetrics['ambient'] }) {
  const total = ambient.triggeredCount + ambient.manualCount
  return (
    <div className={`${listStyles.card} ${styles.kpiCard}`} data-testid="kpi-ambient">
      <Text as="p" size="small" className={listStyles.muted}>Ambient vs. manual</Text>
      <Text as="p" className={styles.kpiValue}>
        {ambient.ambientPercent == null ? '—' : `${ambient.ambientPercent.toFixed(0)}%`}
      </Text>
      <Text as="p" size="small" className={listStyles.muted}>
        {total === 0
          ? 'No runs yet in this range.'
          : `${ambient.triggeredCount} ran on their own (hotkey, schedule, watch) · ${ambient.manualCount} you ran ` +
            'by hand.'}
      </Text>
    </div>
  )
}
