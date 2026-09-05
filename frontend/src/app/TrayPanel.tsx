import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Text } from '@primer/react'
import { Events } from '@wailsio/runtime'
import { ExecutionService, SettingsService, CompositionService } from '../shared/bindings'
import { isVaultWait } from '../shared/parkReason'
import { GuardrailService } from '../../bindings/github.com/alicoding/mill/internal/services/guardrailsvc'
import type { RunSummary } from '../../bindings/github.com/alicoding/mill/internal/services/executionsvc/models'
import { recentRuns, runningRuns, settledRunKind } from './trayPanelRuns'
import { background } from '../shared/background'
import { runCommand } from '../shared/commands'
import type { CommandContext } from '../shared/commandContext'
import styles from './TrayPanel.module.css'

// The menu-bar status panel (docs/goals/0189): the surface the tray
// icon toggles via SystemTray.AttachWindow. Presence, pending human
// action, running work with Stop, and the honest quit contract --
// exactly the design contract in the goal file, nothing more. Its own
// window and component family, deliberately NOT the Quick Panel
// (a search-and-run surface with separate summon machinery).

interface NeedsYouRow {
  key: string
  title: string
  detail: string
  // The run behind this row, when there is one (goal 0343) -- clicking
  // the row then opens that run rather than the queue it sits in.
  ctx?: CommandContext
}

const MAX_NEEDS_ROWS = 5

function startedAgo(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

export function TrayPanel() {
  const { t } = useTranslation('app')
  const [needsYou, setNeedsYou] = useState<NeedsYouRow[]>([])
  const [running, setRunning] = useState<RunSummary[]>([])
  const [recent, setRecent] = useState<RunSummary[]>([])
  const [automaticCount, setAutomaticCount] = useState(0)
  const [confirmingQuit, setConfirmingQuit] = useState(false)

  // The needs-you rows jump to a VIEW, not a row: their three sources
  // (parked runs, agent write requests, guarded actions) share no
  // single target, so the row opens the Review queue rather than one
  // record. Still a background() call -- there is no view-jump command
  // for an auxiliary window beyond panel.openMill's bare focus.
  const openMain = (view: string) => {
    void background(SettingsService.OpenMainWindow(view), 'trayPanel.openMain')
  }

  const refresh = () => {
    void Promise.all([
      ExecutionService.ListRuns().then((r) => r ?? []).catch(() => [] as RunSummary[]),
      SettingsService.PendingMCPWrites().then((p) => p ?? []).catch(() => []),
      GuardrailService.PendingGuardedActions().then((a) => a ?? []).catch(() => []),
    ]).then(([runs, writes, actions]) => {
      const rows: NeedsYouRow[] = [
        ...runs.filter((r) => r.pending).map((r) => ({
          key: `run-${r.runID}`,
          title: r.workflowLabel || r.workflowID,
          detail: isVaultWait(r.pending) ? t('trayPanel.waitingVault') : t('trayPanel.waitingApproval'),
          // A parked run has a run to open; an agent write request and
          // a guarded action have none, so those rows keep the queue
          // as their destination.
          ctx: { kind: 'run' as const, runId: r.runID, workflowId: r.workflowID },
        })),
        ...writes.map((w) => ({
          key: `write-${w.id}`,
          title: t('trayPanel.agentWrite'),
          detail: w.description ?? '',
        })),
        ...actions.map((a) => ({
          key: `action-${a.id}`,
          title: a.source || a.kind,
          detail: a.description ?? '',
        })),
      ]
      setNeedsYou(rows)
      setRunning(runningRuns(runs))
      setRecent(recentRuns(runs))
    })
    // The quit contract's honest count: workflows carrying a
    // non-manual trigger node -- the schedules, hotkeys and watchers
    // that genuinely stop when Mill quits.
    void background(CompositionService.Workflows()
      .then((wfs) => {
        const automatic = (wfs ?? []).filter((wf) =>
          (wf.Nodes ?? []).some((n) => n.NodeTypeID.startsWith('trigger-') && n.NodeTypeID !== 'trigger-manual'),
        )
        setAutomaticCount(automatic.length)
      }), 'tray.workflows')
  }

  // Same display-only refresh pattern the Quick Panel's review count
  // uses: the park/resolve events that already exist, plus a slow
  // interval so a run finishing (which has no dedicated event) is
  // never stale for long.
  useEffect(() => {
    refresh()
    const offGuardrail = Events.On('guardrail-pending-changed', refresh)
    const offMCP = Events.On('mcp-write-approval', refresh)
    const timer = window.setInterval(refresh, 5000)
    window.addEventListener('focus', refresh)
    return () => {
      offGuardrail()
      offMCP()
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Stop and the recent rows are registry commands with this row's own
  // run as their target (goal 0343) -- the label, the effect and the
  // failure reporting all live in shared/rowCommands.ts, and this
  // window supplies only WHICH run.
  const stopRun = (run: RunSummary) => {
    void runCommand('run.stop', { kind: 'run', runId: run.runID, workflowId: run.workflowID }).then(refresh)
  }

  return (
    <div className={styles.panel} data-testid="tray-panel">
      <div className={styles.header}>
        <span className={styles.presenceDot} aria-hidden />
        {/* The product's own name, never translated. */}
        <Text weight="semibold">Mill</Text>
        <Text size="small" className={styles.muted}>{t('trayPanel.running')}</Text>
        <div className={styles.spacer} />
        {/* The exact action panel.openMill already registers (shared/settingsCommands.ts) -- routed through
            runCommand rather than a second direct SettingsService.OpenMainWindow('') call (goal 0335). */}
        <Button size="small" variant="invisible" onClick={() => { void runCommand('panel.openMill') }} data-testid="tray-open-mill">
          {t('trayPanel.openMill')}
        </Button>
      </div>

      {needsYou.length > 0 && (
        <div className={styles.section} data-testid="tray-needs-you">
          <Text size="small" weight="semibold" className={styles.sectionTitle}>{t('trayPanel.needsYou')}</Text>
          {needsYou.slice(0, MAX_NEEDS_ROWS).map((row) => (
            <button
              key={row.key}
              type="button"
              className={styles.row}
              onClick={() => { if (row.ctx) void runCommand('run.open', row.ctx); else openMain('review') }}
              data-testid="tray-needs-row"
            >
              <span className={styles.rowTitle}>{row.title}</span>
              <span className={styles.rowDetail}>{row.detail}</span>
            </button>
          ))}
          {needsYou.length > MAX_NEEDS_ROWS && (
            <button type="button" className={styles.row} onClick={() => openMain('review')} data-testid="tray-view-all">
              <span className={styles.rowDetail}>{t('trayPanel.viewAll', { count: needsYou.length })}</span>
            </button>
          )}
        </div>
      )}
      {needsYou.length === 0 && (
        <Text size="small" className={`${styles.muted} ${styles.emptyLine}`} data-testid="tray-nothing-waiting">
          {t('trayPanel.nothingWaiting')}
        </Text>
      )}

      <div className={styles.section} data-testid="tray-running-section">
        <Text size="small" weight="semibold" className={styles.sectionTitle}>{t('trayPanel.runningSection')}</Text>
        {running.length === 0 && (
          <Text size="small" className={`${styles.muted} ${styles.emptyLine}`} data-testid="tray-nothing-running">
            {t('trayPanel.nothingRunning')}
          </Text>
        )}
        {running.map((r) => (
          <div key={r.runID} className={styles.runRow} data-testid="tray-run-row">
            <div className={styles.runInfo}>
              <span className={styles.rowTitle}>{r.workflowLabel || r.workflowID}</span>
              <span className={styles.rowDetail}>{startedAgo(String(r.startedAt))}</span>
            </div>
            <Button size="small" variant="invisible" className={styles.stopButton} onClick={() => stopRun(r)} data-testid="tray-stop-run">
              {t('trayPanel.stop')}
            </Button>
          </div>
        ))}
      </div>

      {/* Recent (goal 0294): a settled run, one click from its steps in
          the run monitor window -- the "did it work" answer from the
          menu bar, without opening the full app. */}
      <div className={styles.section} data-testid="tray-recent-section">
        <Text size="small" weight="semibold" className={styles.sectionTitle}>{t('trayPanel.recentSection')}</Text>
        {recent.length === 0 && (
          <Text size="small" className={`${styles.muted} ${styles.emptyLine}`} data-testid="tray-no-runs-yet">
            {t('trayPanel.noRunsYet')}
          </Text>
        )}
        {recent.map((r) => {
          const kind = settledRunKind(r.status)
          return (
            <button key={r.runID} type="button" className={styles.row} onClick={() => { void runCommand('run.monitor', { kind: 'run', runId: r.runID, workflowId: r.workflowID }) }} data-testid="tray-recent-row" data-run-kind={kind}>
              <span className={styles.rowTitle}>{r.workflowLabel || r.workflowID}</span>
              <span className={styles.rowDetail}>
                {t(kind === 'done' ? 'trayPanel.runDone' : kind === 'failed' ? 'trayPanel.runFailed' : 'trayPanel.runStopped')} · {startedAgo(String(r.completedAt || r.startedAt))}
              </span>
            </button>
          )
        })}
      </div>

      <div className={styles.footer}>
        {!confirmingQuit && (
          <Button size="small" variant="invisible" onClick={() => setConfirmingQuit(true)} data-testid="tray-quit">
            {t('trayPanel.quit')}
          </Button>
        )}
        {confirmingQuit && (
          <div className={styles.quitBlock} data-testid="tray-quit-contract">
            <Text size="small" className={styles.muted}>
              {automaticCount > 0
                ? t('trayPanel.quitContract', { count: automaticCount })
                : t('trayPanel.quitContractNone')}
            </Text>
            <div className={styles.quitButtons}>
              <Button size="small" variant="danger" onClick={() => void SettingsService.QuitApp()} data-testid="tray-quit-confirm">
                {t('trayPanel.quitConfirm')}
              </Button>
              <Button size="small" onClick={() => setConfirmingQuit(false)} data-testid="tray-keep-running">
                {t('trayPanel.keepRunning')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
