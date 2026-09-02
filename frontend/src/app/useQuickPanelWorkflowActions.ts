import { useEffect, useState } from 'react'
import { ExecutionService, RunKind, SettingsService } from '../shared/bindings'
import { generateSamplePayload } from '../shared/configSchema'
import { workflowTarget } from './navigateTarget'

// A workflow row's actions in the Quick Panel (goal 0294), shaped on
// the launcher convention every user of one already knows: Enter is
// the primary action, ⌘Enter the secondary, ⌘K opens the full list
// with each action's own shortcut. Actions are keyed off the row the
// list currently has active (FilteredActionList's
// onActiveDescendantChanged), so the shortcuts work without a click.
//
// Run no longer hides the panel on completion: the outcome (done in
// Ns / failed: why / waiting for approval) stays in the footer until
// Escape, and ⌘Enter then opens that exact run on the canvas.
export interface RowAction {
  id: 'run' | 'run-watch' | 'open' | 'pin'
  label: string
  shortcut: string
  run: () => void
}

interface WorkflowLike {
  ID: string
  Label: string
  Attributes?: Parameters<typeof generateSamplePayload>[0] | null
}

interface Params {
  workflows: WorkflowLike[] | null
  pinnedWorkflowIds: string[]
  togglePinnedWorkflow: (id: string) => void
  setStatus: (text: string | null) => void
  t: (key: string, opts?: Record<string, unknown>) => string
}

const IN_FLIGHT = new Set(['PENDING', 'RUNNING', 'ENQUEUED'])

// Duration from the run record's own timestamps (server-measured).
function runSeconds(startedAt: unknown, completedAt: unknown): string {
  const ms = Date.parse(String(completedAt)) - Date.parse(String(startedAt))
  return Number.isFinite(ms) && ms >= 0 ? (ms / 1000).toFixed(1) : '0.0'
}

export function useQuickPanelWorkflowActions({ workflows, pinnedWorkflowIds, togglePinnedWorkflow, setStatus, t }: Params) {
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  // The run Enter last started, so ⌘Enter opens THAT run's steps.
  const [lastRun, setLastRun] = useState<{ workflowId: string; runId: string } | null>(null)

  const activeWorkflowId = activeEntryId?.startsWith('run:') ? activeEntryId.slice('run:'.length) : null
  const activeWorkflow = activeWorkflowId ? (workflows?.find((w) => w.ID === activeWorkflowId) ?? null) : null

  const openMain = (view: string) => {
    void SettingsService.OpenMainWindow(view).catch(() => {})
  }

  const valuesFor = (wf: WorkflowLike) => {
    const attrs = wf.Attributes ?? []
    return attrs.length > 0 ? generateSamplePayload(attrs) : null
  }

  // Same RPC + RunKind CompositionView's list-row Run button and
  // CommandPalette's runWorkflowTest use (docs/adr/0008's single
  // execution path); declared Attributes run with sample defaults, the
  // "quick invoke skips the review dialog" rule both already document.
  const runWorkflow = (wf: WorkflowLike) => {
    setStatus(t('quickPanel.status.running', { label: wf.Label }))
    ExecutionService.RunWorkflow(wf.ID, RunKind.RunKindTest, valuesFor(wf))
      .then((summary) => {
        setLastRun({ workflowId: wf.ID, runId: summary.runID })
        if (summary.error) setStatus(t('quickPanel.status.failed', { label: wf.Label, error: summary.error }))
        // The RPC returns when the run settles OR parks: a parked run
        // comes back still PENDING (its pending approval is only on the
        // GetRun/ListRuns shapes), so in-flight-at-return means parked.
        else if (summary.pending || IN_FLIGHT.has(summary.status)) setStatus(t('quickPanel.status.parked', { label: wf.Label }))
        else setStatus(t('quickPanel.status.done', { label: wf.Label, seconds: runSeconds(summary.startedAt, summary.completedAt) }))
      })
      .catch((err) => {
        setStatus(t('quickPanel.status.failed', { label: wf.Label, error: String(err) }))
      })
  }

  // Fire the run, then open the canvas on the workflow's newest run:
  // the run record exists before the main window finishes navigating,
  // so the canvas adopts this run whether it is still stepping or
  // already finished (shared/workTabs.ts's 'latest').
  const runAndWatch = (wf: WorkflowLike) => {
    ExecutionService.RunWorkflow(wf.ID, RunKind.RunKindTest, valuesFor(wf)).catch(() => {})
    openMain(workflowTarget(wf.ID, 'latest'))
  }

  const openWorkflow = (wf: WorkflowLike) => {
    const runId = lastRun?.workflowId === wf.ID ? lastRun.runId : undefined
    openMain(workflowTarget(wf.ID, runId))
  }

  const actionsFor = (wf: WorkflowLike): RowAction[] => [
    { id: 'run', label: t('quickPanel.actions.run'), shortcut: '↩', run: () => runWorkflow(wf) },
    { id: 'run-watch', label: t('quickPanel.actions.runAndWatch'), shortcut: '⌘⇧↩', run: () => runAndWatch(wf) },
    { id: 'open', label: t('quickPanel.actions.openWorkflow'), shortcut: '⌘↩', run: () => openWorkflow(wf) },
    {
      id: 'pin',
      label: pinnedWorkflowIds.includes(wf.ID) ? t('quickPanel.actions.unpin') : t('quickPanel.actions.pin'),
      shortcut: '⌘⇧P',
      run: () => togglePinnedWorkflow(wf.ID),
    },
  ]

  const actions = activeWorkflow ? actionsFor(activeWorkflow) : []

  // Capture phase, ahead of FilteredActionList's own Enter re-dispatch
  // to the active row -- otherwise ⌘Enter would also fire Enter's Run.
  // ⌘, is the one non-row binding (Settings), kept here with the rest.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === ',') {
        e.preventDefault()
        openMain('settings')
        return
      }
      if (!activeWorkflow) return
      const fire = (id: RowAction['id']) => {
        e.preventDefault()
        e.stopPropagation()
        setActionsOpen(false)
        actionsFor(activeWorkflow).find((a) => a.id === id)?.run()
      }
      if (e.key === 'Enter' && e.shiftKey) fire('run-watch')
      else if (e.key === 'Enter') fire('open')
      else if ((e.key === 'p' || e.key === 'P') && e.shiftKey) fire('pin')
      else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault()
        setActionsOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- actionsFor closes over the same state the deps already list
  }, [activeWorkflow, lastRun, pinnedWorkflowIds])

  return {
    activeWorkflow,
    actions,
    actionsOpen,
    setActionsOpen,
    runWorkflow,
    // Sticky: the list drops its active descendant whenever focus
    // leaves it (opening the Actions menu does exactly that), and the
    // row the user last had active is still the row they mean.
    onActiveDescendantChanged: (current: HTMLElement | undefined) => setActiveEntryId((prev) => current?.dataset.entryId ?? prev),
  }
}
