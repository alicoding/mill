import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, Button, Heading, SegmentedControl, Select, Spinner, Stack, Text } from '@primer/react'
import { StatusStamp } from '../shared/StatusStamp'
import { Blankslate } from '@primer/react/experimental'
import { BugIcon, InboxIcon, PersonIcon, PlugIcon, ShieldIcon } from '@primer/octicons-react'
import { SettingsService } from '../shared/bindings'
import type { MCPWriteResolved, RunSummary } from '../shared/bindings'
import { ApprovalValuesForm, attrsForPending } from '../shared/ApprovalValuesForm'
import { useAppStore } from '../shared/store'
import { useUISignalStore } from '../shared/uiSignalStore'
import { formatRunStartedAt, runStatusLabel } from '../shared/runTime'
import { useApprovalResolution } from '../shared/approvalResolution'
import { usePendingReview } from '../review/usePendingReview'
import { StalenessBadge } from '../shared/StalenessBadge'
import { ReviewGuardedActions } from './ReviewGuardedActions'
import { formatLastChecked } from '../shared/staleness'
import { ReviewAlwaysRuleDialog } from './ReviewAlwaysRuleDialog'
import { GuardrailRulesPanel } from './GuardrailRulesPanel'
import styles from '../shared/ListCard.module.css'
import monoStyles from '../shared/monoText.module.css'
import mobileStyles from './ReviewView.module.css'
import PageContainer from '../shared/PageContainer'

type ReviewTab = 'queue' | 'rules'
// The parked run + effect a door-1 "Always…" click is currently
// authoring a rule for -- null means no ReviewAlwaysRuleDialog is open.
interface AlwaysRuleRequest { run: RunSummary; effect: 'allow' | 'deny' }

// The four kinds a Review row can be (goal 0002 item 4) -- discriminated
// off the SAME fields the row's own icon/badge already key on
// (isDebugPark below, PendingApproval.nodeTypeID), never a new field.
// 'mcp-write' isn't a RunSummary at all (docs/adr/0032's own pending
// store) -- it's counted separately and only ever shown when present.
type PendingKind = 'ask' | 'human-review' | 'debug'
type KindFilterValue = '' | PendingKind | 'mcp-write' | 'guarded-action'

// Order the kind Select's options render in when 2+ are present --
// fixed, not Set-insertion-order, so the list doesn't reshuffle as
// different kinds come and go.
const KIND_ORDER: Array<Exclude<KindFilterValue, ''>> = ['ask', 'human-review', 'debug', 'mcp-write', 'guarded-action']

// Wording reused verbatim from what the row itself already renders
// (isDebugPark's Label text, the pendingWrites card's "MCP write
// request" heading, the nodeTypeLabel "Ask for review" the Step line
// already shows) -- the filter must never invent new prose the row
// doesn't already carry. Debug park has two row variants (breakpoint /
// step mode); "Paused at breakpoint" is the base-case wording, since one
// filter bucket covers both.
function kindLabelsFor(t: (key: string) => string): Record<Exclude<KindFilterValue, ''>, string> {
  return {
    ask: t('reviewView.kindLabels.ask'),
    'human-review': t('reviewView.kindLabels.human-review'),
    debug: t('reviewView.kindLabels.debug'),
    'mcp-write': t('reviewView.kindLabels.mcp-write'),
    'guarded-action': t('reviewView.kindLabels.guarded-action'),
  }
}

// The Review queue (docs/adr/0023, §3.2's case-management-style
// "Review" surface in v1 form): every parked run across every workflow
// -- ambient guardrail asks and Human review checkpoints alike, since
// they share one pending mechanism -- in one inbox. A reviewer sees
// exactly what wants to run (§1's what-you-see-is-what-I-see thesis),
// can fill typed input for the workflow's declared Attributes (flows
// into the resumed run), and approves or denies. Composed from the
// already-built parked-run data (ListRuns + pending), deliberately not
// a case-management engine (no assignment/SLA/notes -- the
// Camunda/Pega line, not crossed).
function ReviewView() {
  const { t } = useTranslation('views')
  // The refusal copy lives in the `common` namespace -- the canvas bar
  // and the Runs panel's own parked bar render exactly the same
  // strings (shared/approvalResolution.ts).
  const { t: tc } = useTranslation('common')
  // The shared answer-a-parked-run seam, one call site vocabulary for
  // all three surfaces that render controls on a park.
  const { errorKeyFor, resolveApproval } = useApprovalResolution()
  const KIND_LABELS = kindLabelsFor(t)
  const workflows = useAppStore((s) => s.workflows)
  const requestOpenWorkflow = useAppStore((s) => s.requestOpenWorkflow)
  // The queue's own data comes from the one shared source the sidebar
  // badge and the launch notice also read (review/usePendingReview.ts):
  // parked runs, their resolutions, and the SAME durable pending-write
  // store MCPWriteApprovals.tsx's banner reads -- one store, multiple
  // surfaces, never a second competing pending list (goal 0005), and
  // never a poll standing in for a missed event (goal 0329).
  const { pending: pendingRuns, resolved, pendingWrites, loaded: reviewLoaded, revision, refresh } = usePendingReview()
  const pending = reviewLoaded ? pendingRuns : null
  // Resolved MCP writes (docs/goals/0026 item 6) -- the durable 24h
  // outcome records (approved/denied/cancelled/expired), merged into
  // Recently-resolved alongside run resolutions rather than living in a
  // second, separate list; today only session-only Activity showed
  // these at all, gone on restart even though the record itself was
  // already durable.
  const [resolvedWrites, setResolvedWrites] = useState<MCPWriteResolved[]>([])
  const [inputs, setInputs] = useState<Record<string, Record<string, string>>>({})
  // Parked guarded actions live in their own section (ReviewGuardedActions);
  // the queue blankslate must count them too.
  const [guardedCount, setGuardedCount] = useState(0)
  const [workflowFilter, setWorkflowFilter] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilterValue>('')
  const [error, setError] = useState('')
  // The Queue|Rules split (goal 0078, door 3): Queue is every field
  // above, unchanged; Rules renders GuardrailRulesPanel instead.
  const [tab, setTab] = useState<ReviewTab>('queue')
  // Door 1's "Always…" menu -- which parked run + effect (allow/deny)
  // the ReviewAlwaysRuleDialog below is currently open for.
  const [alwaysRule, setAlwaysRule] = useState<AlwaysRuleRequest | null>(null)

  // review.rules (shared/commands.ts): surface-scoped to Review, so
  // this component is always already mounted when it fires -- the same
  // monotonic-counter/ref-compare shape AtlasView's own atlasJumpRequest
  // watcher uses.
  const reviewRulesRequest = useUISignalStore((s) => s.reviewRulesRequest)
  const lastReviewRulesRequest = useRef(reviewRulesRequest)
  useEffect(() => {
    if (reviewRulesRequest === lastReviewRulesRequest.current) return
    lastReviewRulesRequest.current = reviewRulesRequest
    setTab('rules')
  }, [reviewRulesRequest])

  // Resolved MCP writes are this view's own extra data -- not part of
  // what the badge or the launch notice show -- so they refetch on the
  // shared source's revision instead of on a second set of event
  // subscriptions.
  useEffect(() => {
    SettingsService.ResolvedMCPWrites().then((p) => setResolvedWrites(p ?? [])).catch(() => {})
  }, [revision])

  const resolveWrite = (id: string, approve: boolean) => {
    setError('')
    SettingsService.ResolveMCPWrite(id, approve)
      .then(() => setTimeout(refresh, 300))
      .catch((err) => setError(String(err)))
  }

  // continueRun stays false uniformly (docs/adr/0031 §5): Review's two-
  // button UI has no dedicated Step/Continue distinction, so a plain
  // Approve on a STEPPED run's park behaves like "Step" (advance one
  // node, park again) -- the safe default that never silently skips
  // step mode. A user who wants full Step/Continue/Stop control over a
  // stepped run uses the canvas's own CurrentStepBar instead.
  const resolve = (run: RunSummary, approve: boolean) => {
    if (!run.pending) return
    setError('')
    void resolveApproval({ runID: run.runID, nodeID: run.pending.nodeID, approve, values: inputs[run.runID] })
      .then((delivered) => {
        // A refused decision means this row is stale -- refetch straight
        // away so it stops offering what it just failed to do.
        if (delivered) setTimeout(refresh, 700)
        else refresh()
      })
  }

  // Row drill-down (docs/goals/0002-review-queue-maturation.md item 5):
  // every Review row -- pending or resolved -- opens its run in the
  // app-wide work-tab shell at the workflow's Runs inner tab, with that
  // run's own detail already open. ONE run-detail viewer (docs/SPEC.md
  // §7's lock) -- Review itself never renders run detail.
  const openRun = (run: RunSummary) => requestOpenWorkflow(run.workflowID, run.runID)

  const attrsFor = (run: RunSummary) => attrsForPending(workflows?.find((w) => w.ID === run.workflowID)?.Attributes ?? [], run.pending?.inputAttributes)

  // A breakpoint/step-mode debug park (docs/adr/0031) reads distinctly
  // here too -- never the same badge/wording as a policy ask ("recognition,
  // not confirmation").
  const isDebugPark = (run: RunSummary) => run.pending?.source === 'debug'
  // A Human review checkpoint (internal/domain/composition/humanreview.go)
  // is its own kind, distinct from an ambient guardrail policy ask, even
  // though both currently share the "awaiting approval" badge text -- the
  // leading icon (PersonIcon vs ShieldIcon) is the recognition cue.
  const isHumanReview = (run: RunSummary) => run.pending?.nodeTypeID === 'human-review'
  const pendingKind = (run: RunSummary): PendingKind => {
    if (isDebugPark(run)) return 'debug'
    if (isHumanReview(run)) return 'human-review'
    return 'ask'
  }

  // Kinds actually present right now, across both pending runs and
  // pending MCP writes -- the Select only renders once 2+ are present
  // (the repo's single-option-select-is-noise rule, SPEC §3.5).
  const presentKinds = new Set<Exclude<KindFilterValue, ''>>((pending ?? []).map(pendingKind))
  if (pendingWrites.length > 0) presentKinds.add('mcp-write')
  const showKindFilter = presentKinds.size >= 2
  const kindMatches = (run: RunSummary) => !kindFilter || kindFilter === pendingKind(run)
  const showPendingWrites = kindFilter === '' || kindFilter === 'mcp-write'

  // Recently-resolved is a merged, newest-first list of run resolutions
  // AND resolved MCP writes (docs/goals/0026 item 6) -- one section, not
  // two adjacent lists, same "recognition, not confirmation" discipline
  // the pending rows already use (PlugIcon distinguishes a write row).
  // MCP writes aren't scoped to a workflow, so they're excluded whenever
  // a workflow filter is active (nothing for them to match).
  type ResolvedEntry =
    | { kind: 'run'; key: string; time: number; run: RunSummary }
    | { kind: 'mcp-write'; key: string; time: number; write: MCPWriteResolved }
  const resolvedEntries: ResolvedEntry[] = [
    ...resolved
      .filter((r) => !workflowFilter || r.workflowID === workflowFilter)
      .map((run): ResolvedEntry => ({ kind: 'run', key: run.runID, time: Date.parse(run.completedAt || run.startedAt), run })),
    ...(workflowFilter ? [] : resolvedWrites.map((w): ResolvedEntry => ({ kind: 'mcp-write', key: w.id, time: Date.parse(w.resolvedAt), write: w }))),
  ].sort((a, b) => b.time - a.time)

  // Loading: the first ListRuns() round trip hasn't resolved yet --
  // Home.tsx's own centered-Spinner-under-the-Heading treatment is the
  // suite's standard for this (no dedicated skeleton component exists).
  if (pending === null) {
    return (
      <PageContainer data-testid="review-view">
        {/* Design-wave-1 fix #6: the sidebar nav row already says
            "Review" -- the h1 is now the descriptive subtitle itself. */}
        <Heading as="h1" variant="medium">{t('reviewView.subtitle')}</Heading>
        <Spinner />
      </PageContainer>
    )
  }

  return (
    <PageContainer data-testid="review-view">
      <Heading as="h1" variant="medium" className={styles.muted}>
        {t('reviewView.subtitle')}
      </Heading>
      {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}

      {/* Queue|Rules split (goal 0078, door 3) -- Queue is every field
          below, unchanged; Rules renders the audit view instead. */}
      <SegmentedControl aria-label={t('reviewView.subtitle')} onChange={(i) => setTab(i === 1 ? 'rules' : 'queue')}>
        <SegmentedControl.Button selected={tab === 'queue'} data-testid="review-tab-queue">{t('reviewView.tabs.queue')}</SegmentedControl.Button>
        <SegmentedControl.Button selected={tab === 'rules'} data-testid="review-tab-rules">{t('reviewView.tabs.rules')}</SegmentedControl.Button>
      </SegmentedControl>

      {tab === 'rules' && <GuardrailRulesPanel />}

      {tab === 'queue' && (<>
      {(pending.length > 0 || resolved.length > 0) && (
        <Stack direction="horizontal" gap="condensed" align="center">
          <Select value={workflowFilter} onChange={(e) => setWorkflowFilter(e.target.value)} aria-label={t('reviewView.filterByWorkflowAriaLabel')}>
            <Select.Option value="">{t('reviewView.allWorkflows')}</Select.Option>
            {[...new Set([...pending, ...resolved].map((r) => r.workflowID))].map((id) => (
              <Select.Option key={id} value={id}>
                {workflows?.find((w) => w.ID === id)?.Label ?? id}
              </Select.Option>
            ))}
          </Select>
          {showKindFilter && (
            <Select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as KindFilterValue)}
              aria-label={t('reviewView.filterByKindAriaLabel')}
              data-testid="review-kind-filter"
            >
              <Select.Option value="">{t('reviewView.allKinds')}</Select.Option>
              {KIND_ORDER.filter((k) => presentKinds.has(k)).map((k) => (
                <Select.Option key={k} value={k}>{KIND_LABELS[k]}</Select.Option>
              ))}
            </Select>
          )}
        </Stack>
      )}

      {pending.length === 0 && pendingWrites.length === 0 && guardedCount === 0 && (
        <Blankslate data-testid="review-empty">
          <Blankslate.Visual>
            <InboxIcon size={32} />
          </Blankslate.Visual>
          <Blankslate.Heading>{t('reviewView.nothingWaiting')}</Blankslate.Heading>
          <Blankslate.Description>{t('reviewView.nothingWaitingDescription')}</Blankslate.Description>
        </Blankslate>
      )}

      {/* Pending MCP writes (docs/adr/0032 §2): a distinct icon/label
          from a guardrail/debug park ("recognition, not confirmation")
          -- these are an external MCP client asking to change Mill's
          own data, not a workflow run paused mid-execution. Not
          filterable by workflow (they aren't scoped to one), but the
          kind filter does hide them like any other kind. */}
      <Stack direction="vertical" gap="normal">
        {showPendingWrites && pendingWrites.map((w) => {
          const lastChecked = formatLastChecked(w.lastPolledAt)
          return (
            <div key={w.id} className={styles.card} data-testid="review-mcp-write-item" data-mcp-write-id={w.id}>
              <Stack direction="vertical" gap="condensed">
                <Stack direction="horizontal" gap="condensed" align="center">
                  <PlugIcon size={16} />
                  <Text weight="semibold">{t('reviewView.mcpWriteRequest')}</Text>
                  <StatusStamp variant="caution">{t('reviewView.awaitingApprovalLower')}</StatusStamp>
                  <StalenessBadge createdAt={w.createdAt} testId="review-mcp-write-age" />
                </Stack>
                <Text size="small">{w.description}</Text>
                {/* Requester-liveness hint (docs/goals/0026 item 3): only
                    rendered once check_write_status hasn't been called in
                    >5m -- an abandoned request visibly reads as abandoned,
                    a fresh-polling one stays silent (no noise). */}
                {lastChecked && (
                  <Text size="small" className={styles.muted} data-testid="review-mcp-write-last-checked">{lastChecked}</Text>
                )}
                <Stack direction="horizontal" gap="condensed" className={mobileStyles.approvalActions}>
                  <Button size="small" variant="primary" data-testid="review-mcp-write-approve" onClick={() => resolveWrite(w.id, true)}>
                    {t('reviewView.approve')}
                  </Button>
                  <Button size="small" variant="danger" data-testid="review-mcp-write-deny" onClick={() => resolveWrite(w.id, false)}>
                    {t('reviewView.deny')}
                  </Button>
                </Stack>
              </Stack>
            </div>
          )
        })}
      </Stack>

      <ReviewGuardedActions visible={kindFilter === '' || kindFilter === 'guarded-action'} onCount={setGuardedCount} />

      <Stack direction="vertical" gap="normal">
        {pending.filter((r) => (!workflowFilter || r.workflowID === workflowFilter) && kindMatches(r)).map((run) => (
          <div
            key={run.runID}
            className={`${styles.card} ${styles.activityRowClickable}`}
            data-testid="review-item"
            onClick={() => openRun(run)}
          >
            <Stack direction="vertical" gap="condensed">
              <Stack direction="horizontal" gap="condensed" align="center">
                {isDebugPark(run) ? <BugIcon size={16} /> : isHumanReview(run) ? <PersonIcon size={16} /> : <ShieldIcon size={16} />}
                <Text weight="semibold">{run.workflowLabel}</Text>
                <StatusStamp variant={isDebugPark(run) ? 'identity' : 'caution'} data-testid={isDebugPark(run) ? 'review-debug-badge' : undefined}>
                  {isDebugPark(run) ? (run.pending?.stepped ? t('reviewView.pausedStepModeLower') : t('reviewView.pausedAtBreakpointLower')) : t('reviewView.awaitingApprovalLower')}
                </StatusStamp>
                <StalenessBadge createdAt={run.startedAt} testId="review-item-age" />
              </Stack>
              <Text size="small">
                {t('reviewView.stepPrefix')} <Text weight="semibold">{run.pending?.nodeTypeLabel || run.pending?.nodeTypeID}</Text>
                {run.pending?.ruleLabel ? t('reviewView.ruleSuffix', { rule: run.pending.ruleLabel }) : t('reviewView.externalStepsDefault')}
              </Text>
              {run.pending?.payload && <pre className={styles.result}>{run.pending.payload}</pre>}

              {/* stopPropagation on this whole interactive block: the
                  card itself now opens the run (row drill-down, goal
                  0002 item 5) -- typing input or clicking Approve/Deny
                  must not also trigger that navigation. */}
              <ApprovalValuesForm
                attrs={attrsFor(run)}
                values={inputs[run.runID] ?? {}}
                onChange={(key, value) => setInputs((prev) => ({ ...prev, [run.runID]: { ...prev[run.runID], [key]: value } }))}
              />

              <Stack direction="horizontal" gap="condensed" className={mobileStyles.approvalActions} onClick={(e) => e.stopPropagation()}>
                <Button size="small" variant="primary" data-testid="review-approve" onClick={() => resolve(run, true)}>
                  {isDebugPark(run) ? t('reviewView.resume') : t('reviewView.approveAndResume')}
                </Button>
                <Button size="small" variant="danger" data-testid="review-deny" onClick={() => resolve(run, false)}>
                  {isDebugPark(run) ? t('reviewView.stop') : t('reviewView.deny')}
                </Button>
                {errorKeyFor(run.runID) && (
                  <Text as="p" className={styles.error} data-testid="review-resolve-error">{tc(errorKeyFor(run.runID))}</Text>
                )}
                {/* Door 1, primary authoring door (goal 0078): only a
                    guardrail policy ask carries a scope a rule can name --
                    a Human review checkpoint always parks by construction
                    (no rule vouches it away) and a debug park is step-mode
                    plumbing, not policy, so neither offers this. */}
                {pendingKind(run) === 'ask' && (
                  <ActionMenu>
                    <ActionMenu.Button size="small" variant="invisible" data-testid="review-always-menu">
                      {t('reviewView.alwaysButton')}
                    </ActionMenu.Button>
                    <ActionMenu.Overlay>
                      <ActionList>
                        <ActionList.Item onSelect={() => setAlwaysRule({ run, effect: 'allow' })} data-testid="review-always-allow">
                          {t('reviewView.alwaysAllowMenuItem')}
                        </ActionList.Item>
                        <ActionList.Item onSelect={() => setAlwaysRule({ run, effect: 'deny' })} data-testid="review-always-deny">
                          {t('reviewView.alwaysDenyMenuItem')}
                        </ActionList.Item>
                      </ActionList>
                    </ActionMenu.Overlay>
                  </ActionMenu>
                )}
              </Stack>
            </Stack>
          </div>
        ))}
      </Stack>
      {resolvedEntries.length > 0 && (
        <>
          <Heading as="h2" variant="small" className={styles.sectionHeading}>{t('reviewView.recentlyResolved')}</Heading>
          <Stack direction="vertical" gap="condensed">
            {resolvedEntries.slice(0, 10).map((entry) => entry.kind === 'run' ? (
              <div
                key={entry.key}
                className={`${styles.card} ${styles.activityRowClickable}`}
                data-testid="review-resolved-item"
                onClick={() => openRun(entry.run)}
              >
                <Stack direction="horizontal" gap="condensed" align="center" justify="space-between">
                  <Stack direction="horizontal" gap="condensed" align="center">
                    <Text weight="semibold">{entry.run.workflowLabel}</Text>
                    <StatusStamp
                      variant={entry.run.interrupted ? 'neutral' : entry.run.resolution === 'approved' ? 'success' : 'danger'}
                      data-testid="review-resolution"
                    >
                      {entry.run.resolution}
                    </StatusStamp>
                    {/* Design-wave-1 fix #4: ERROR/failed pills were
                        falling through to 'secondary' (gray), the same
                        neutral tone as any other non-SUCCESS status --
                        losing the failure semantics the 'denied'
                        resolution pill right next to it already has in
                        danger. Same three-way mapping
                        ActivityRunsExplorer.tsx's own run-status pill
                        already uses correctly. */}
                    <StatusStamp
                      variant={entry.run.status === 'SUCCESS' ? 'success' : entry.run.status === 'ERROR' ? 'danger' : 'caution'}
                      data-testid="review-resolved-status"
                    >
                      {runStatusLabel(entry.run, t)}
                    </StatusStamp>
                  </Stack>
                  <Text size="small" className={`${styles.muted} ${monoStyles.mono}`}>{formatRunStartedAt(entry.run.startedAt)}</Text>
                </Stack>
              </div>
            ) : (
              // A resolved MCP write (docs/goals/0026 item 6) -- the same
              // durable 24h outcome record check_write_status reads,
              // surfaced here so it isn't only visible via session-only
              // Activity (gone on restart). PlugIcon matches the pending
              // row's own identity cue ("recognition, not confirmation");
              // not clickable -- there's no run to drill into.
              <div key={entry.key} className={styles.card} data-testid="review-resolved-mcp-write-item">
                <Stack direction="horizontal" gap="condensed" align="center" justify="space-between">
                  <Stack direction="horizontal" gap="condensed" align="center">
                    <PlugIcon size={16} />
                    <Text weight="semibold">{entry.write.description}</Text>
                    <StatusStamp
                      variant={entry.write.status === 'approved' ? 'success' : 'danger'}
                      data-testid="review-resolved-mcp-write-status"
                    >
                      {entry.write.status}
                    </StatusStamp>
                  </Stack>
                  <Text size="small" className={`${styles.muted} ${monoStyles.mono}`}>{formatRunStartedAt(entry.write.resolvedAt)}</Text>
                </Stack>
              </div>
            ))}
          </Stack>
        </>
      )}
      </>)}

      {alwaysRule && (
        <ReviewAlwaysRuleDialog
          run={alwaysRule.run}
          effect={alwaysRule.effect}
          onClose={() => setAlwaysRule(null)}
          onResolved={() => { setAlwaysRule(null); setTimeout(refresh, 300) }}
        />
      )}
    </PageContainer>
  )
}

export default ReviewView
