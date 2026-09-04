import { useCallback, useEffect, useState } from 'react'
import { ExecutionService, RunKind, SettingsService } from '../shared/bindings'
import { generateSamplePayload } from '../shared/configSchema'
import { commandLabel, findCommand, runCommand } from '../shared/commands'
import type { CommandContext } from '../shared/commandContext'
import { background } from '../shared/background'

// A workflow row's actions in the Quick Panel (goal 0294), shaped on
// the launcher convention every user of one already knows: Enter is
// the primary action, ⌘Enter the secondary, ⌘K opens the full list
// with each action's own shortcut. Actions are keyed off the row the
// list currently has active (FilteredActionList's
// onActiveDescendantChanged), falling back to the first visible row.
//
// Run no longer hides the panel on completion: the outcome (done in
// Ns / failed: why / waiting for approval) stays in the footer until
// Escape, and ⌘Enter then opens that exact run on the canvas.
// A row action names a registry command and the row it acts on (goal
// 0343) -- the panel supplies WHICH workflow and which key reaches it,
// never what the action does. `run` stays only on the Enter row, whose
// effect is inseparable from the panel-footer status it writes (see
// useQuickPanelRun below); every other action is the command alone.
export interface RowAction {
  id: 'run' | 'run-watch' | 'open' | 'pin'
  label: string
  shortcut: string
  commandId?: string
  ctx?: CommandContext
  run?: () => void
}

// runRowAction is the one execution door for a row action: a registry
// command with this row's target, or the Enter row's own closure.
export function runRowAction(action: RowAction) {
  if (action.commandId) void runCommand(action.commandId, action.ctx)
  else action.run?.()
}

// A command's own label when it has one, so a row never restates what
// the registry already says; the panel's existing string is the
// fallback for a command id that has somehow gone missing.
function labelFor(commandId: string, fallback: string): string {
  const command = findCommand(commandId)
  return command ? commandLabel(command) : fallback
}

interface WorkflowLike {
  ID: string
  Label: string
  Attributes?: Parameters<typeof generateSamplePayload>[0] | null
}

type Translate = (key: string, opts?: Record<string, unknown>) => string
export interface LastRun { workflowId: string; runId: string }

const IN_FLIGHT = new Set(['PENDING', 'RUNNING', 'ENQUEUED'])

// Duration from the run record's own timestamps (server-measured).
function runSeconds(startedAt: unknown, completedAt: unknown): string {
  const ms = Date.parse(String(completedAt)) - Date.parse(String(startedAt))
  return Number.isFinite(ms) && ms >= 0 ? (ms / 1000).toFixed(1) : '0.0'
}

const openMain = (view: string) => {
  void background(SettingsService.OpenMainWindow(view), 'quickPanelWorkflowActions.openMainWindow')
}

const valuesFor = (wf: WorkflowLike) => {
  const attrs = wf.Attributes ?? []
  return attrs.length > 0 ? generateSamplePayload(attrs) : null
}

// The row the shortcuts act on: the list's active row while it is
// still on screen, else the first visible workflow row. The list
// reports no active row until the pointer or an arrow key touches it
// -- after a summon from another app that is the common case -- and a
// shortcut with no target used to fall through to the system, which
// beeps.
export function resolveActiveWorkflowId(activeEntryId: string | null, visibleWorkflowIds: string[]): string | null {
  const active = activeEntryId?.startsWith('run:') ? activeEntryId.slice('run:'.length) : null
  if (active && visibleWorkflowIds.includes(active)) return active
  return visibleWorkflowIds[0] ?? null
}

// Enter's Run, and the run it last started (so ⌘Enter opens THAT run).
// Its own hook so the panel can build its rows from runWorkflow before
// it knows which rows are visible.
export function useQuickPanelRun({ setStatus, t }: { setStatus: (text: string | null) => void; t: Translate }) {
  const [lastRun, setLastRun] = useState<LastRun | null>(null)
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
  return { runWorkflow, lastRun }
}

interface Params {
  workflows: WorkflowLike[] | null
  // Workflow ids of the rows currently listed, in list order.
  visibleWorkflowIds: string[]
  pinnedWorkflowIds: string[]
  runWorkflow: (wf: WorkflowLike) => void
  lastRun: LastRun | null
  t: Translate
}

export function useQuickPanelWorkflowActions({ workflows, visibleWorkflowIds, pinnedWorkflowIds, runWorkflow, lastRun, t }: Params) {
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  const activeWorkflowId = resolveActiveWorkflowId(activeEntryId, visibleWorkflowIds)
  const activeWorkflow = activeWorkflowId ? (workflows?.find((w) => w.ID === activeWorkflowId) ?? null) : null

  // ⌘↩ opens the run this panel just started when there is one, and the
  // workflow itself otherwise -- two commands, and the row's label says
  // which one it will do.
  const openAction = (wf: WorkflowLike): { commandId: string; ctx: CommandContext } => {
    const runId = lastRun?.workflowId === wf.ID ? lastRun.runId : undefined
    return runId
      ? { commandId: 'run.open', ctx: { kind: 'run', runId, workflowId: wf.ID } }
      : { commandId: 'workflow.open', ctx: { kind: 'workflow', workflowId: wf.ID } }
  }

  const actionsFor = (wf: WorkflowLike): RowAction[] => {
    const workflowCtx: CommandContext = { kind: 'workflow', workflowId: wf.ID }
    const open = openAction(wf)
    const pinned = pinnedWorkflowIds.includes(wf.ID)
    return [
      // Enter's Run keeps its own closure: the outcome it writes into
      // the panel footer (done in Ns / failed: why / waiting for
      // approval) is panel-local presentation a Command's run() has no
      // channel for.
      { id: 'run', label: t('quickPanel.actions.run'), shortcut: '↩', run: () => runWorkflow(wf) },
      { id: 'run-watch', label: t('quickPanel.actions.runAndWatch'), shortcut: '⌘⇧↩', commandId: 'workflow.runAndWatch', ctx: workflowCtx },
      { id: 'open', label: labelFor(open.commandId, t('quickPanel.actions.openWorkflow')), shortcut: '⌘↩', ...open },
      {
        id: 'pin',
        label: pinned ? t('quickPanel.actions.unpin') : t('quickPanel.actions.pin'),
        shortcut: '⌘⇧P',
        commandId: pinned ? 'workflow.unpin' : 'workflow.pin',
        ctx: workflowCtx,
      },
    ]
  }

  const actions = activeWorkflow ? actionsFor(activeWorkflow) : []

  // Capture phase, ahead of FilteredActionList's own Enter re-dispatch
  // to the active row -- otherwise ⌘Enter would also fire Enter's Run.
  // ⌘, is the one non-row binding (Settings), kept here with the rest.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      // Plain Enter is the list's own, EXCEPT when the row it remembers
      // is gone: after a filter change the list keeps pointing at the
      // previous row's element until an arrow key or the pointer
      // re-activates one (later still under load), and its Enter is
      // re-dispatched into a detached node. The launcher convention
      // covers it: Enter runs the top result, the row the shortcuts
      // resolve to.
      const rememberedId = document.activeElement?.getAttribute('aria-activedescendant')
      const rememberedRow = rememberedId ? document.getElementById(rememberedId) : null
      if (!mod && e.key === 'Enter' && !e.shiftKey && activeWorkflow && !rememberedRow) {
        e.preventDefault()
        e.stopPropagation()
        runWorkflow(activeWorkflow)
        return
      }
      if (!mod) return
      if (e.key === ',') {
        e.preventDefault()
        openMain('settings')
        return
      }
      const isPanelShortcut = e.key === 'Enter' || e.key === 'k' || e.key === 'K' || ((e.key === 'p' || e.key === 'P') && e.shiftKey)
      if (!isPanelShortcut) return
      // Always consumed: a panel shortcut with nothing to act on must
      // not reach the system (an unhandled key equivalent beeps).
      e.preventDefault()
      e.stopPropagation()
      if (!activeWorkflow) return
      const fire = (id: RowAction['id']) => {
        setActionsOpen(false)
        const action = actionsFor(activeWorkflow).find((a) => a.id === id)
        if (action) runRowAction(action)
      }
      if (e.key === 'Enter' && e.shiftKey) fire('run-watch')
      else if (e.key === 'Enter') fire('open')
      else if (e.key === 'p' || e.key === 'P') fire('pin')
      else setActionsOpen((open) => !open)
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- actionsFor closes over the same state the deps already list
  }, [activeWorkflow, lastRun, pinnedWorkflowIds, runWorkflow])

  // Sticky: the list drops its active descendant whenever focus
  // leaves it (opening the Actions menu does exactly that), and the
  // row the user last had active is still the row they mean. STABLE
  // identity is load-bearing: the list rebuilds its keyboard focus
  // zone whenever this callback changes, which reset the active row
  // on every arrow press while a fresh closure was handed in each
  // render (goal 0294's regression: Down never advanced).
  const onActiveDescendantChanged = useCallback((current: HTMLElement | undefined) => {
    setActiveEntryId((prev) => current?.dataset.entryId ?? prev)
  }, [])

  return { activeWorkflow, actions, actionsOpen, setActionsOpen, onActiveDescendantChanged }
}
