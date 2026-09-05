import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { dirtyKeysForCloseRequest, pausedRunForCloseRequest } from '../shared/workTabs'
import type { WorkTabCloseRequest } from '../shared/store'
import { useAppStore } from '../shared/store'
import { clearScratch } from '../composition/canvasScratch'
import { CloseTabDialog } from './CloseTabDialog'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { StopPausedRunDialog } from '../shared/StopPausedRunDialog'
import { usePendingReviewStore } from '../review/pendingReviewStore'
import { runCommand } from '../shared/commands'
import { tabLabel } from './workTabLabel'

// The ONE guarded funnel every close path goes through (docs/goals/
// 0048-unsaved-close-guard.md): shared/commands.ts's keyboard dispatch
// (⌘W/⌘⇧W/⌘⌥W) and app/WorkTabShell.tsx's own mouse handlers (✕, the
// canvas Back arrow, the overflow menu's Close all/Close others) all
// set the store's workTabCloseRequest signal instead of calling
// closeWorkTab/closeAllWorkTabs/closeOtherWorkTabs directly; this hook
// is the sole consumer, so a dirty tab is prompted and scratch is
// cleared in exactly one place regardless of which path fired it.
// Mounted once, inside WorkTabShell (which already owns the strip
// every close path lives on).
//
// A clean request (no dirty tabs among the candidates) performs the
// close immediately -- no dialog, matching today's behavior for tabs
// with nothing to lose.

type DialogState =
  | { kind: 'one'; key: string }
  | { kind: 'bulk'; request: WorkTabCloseRequest; count: number }
  | null


export function useWorkTabCloseGuard() {
  const { t } = useTranslation('app')
  const workTabs = useAppStore((s) => s.workTabs)
  const workTabDirty = useAppStore((s) => s.workTabDirty)
  const workTabCloseRequest = useAppStore((s) => s.workTabCloseRequest)
  const consumeWorkTabCloseRequest = useAppStore((s) => s.consumeWorkTabCloseRequest)
  const activeWorkTabKey = useAppStore((s) => s.activeWorkTabKey)
  const activateWorkTab = useAppStore((s) => s.activateWorkTab)
  const closeWorkTab = useAppStore((s) => s.closeWorkTab)
  const closeAllWorkTabs = useAppStore((s) => s.closeAllWorkTabs)
  const closeOtherWorkTabs = useAppStore((s) => s.closeOtherWorkTabs)
  const requestCanvasCommand = useAppStore((s) => s.requestCanvasCommand)
  const workflows = useAppStore((s) => s.workflows)
  const requests = useAppStore((s) => s.requests)

  const [dialog, setDialog] = useState<DialogState>(null)
  // The close being held until the paused-run question is
  // answered -- null when nothing is being asked.
  const [pausedGate, setPausedGate] = useState<WorkTabCloseRequest | null>(null)
  const pausedDebug = usePendingReviewStore((s) => s.pausedDebug)
  const pausedRun = pausedGate ? pausedRunForCloseRequest(workTabs, pausedDebug, pausedGate) : null

  function performClose(request: WorkTabCloseRequest) {
    if (request.kind === 'one') {
      clearScratch(request.key)
      closeWorkTab(request.key)
    } else if (request.kind === 'all') {
      workTabs.forEach((tab) => clearScratch(tab.key))
      closeAllWorkTabs()
    } else {
      workTabs.forEach((tab) => { if (tab.key !== request.keepKey) clearScratch(tab.key) })
      closeOtherWorkTabs(request.keepKey)
    }
  }

  function beginClose(request: WorkTabCloseRequest) {
    const dirtyKeys = dirtyKeysForCloseRequest(workTabs, workTabDirty, request)
    if (dirtyKeys.length === 0) {
      performClose(request)
    } else if (request.kind === 'one') {
      // The tab activates before prompting (VS Code's own dirty-close
      // convention) -- Save has to reach the ACTIVE tab's canvas
      // (composition/useCanvasCommandDispatch.ts only acts for the
      // active work tab), and the prompt itself should show over the
      // tab it's actually asking about.
      if (activeWorkTabKey !== request.key) activateWorkTab(request.key)
      setDialog({ kind: 'one', key: request.key })
    } else {
      setDialog({ kind: 'bulk', request, count: dirtyKeys.length })
    }
  }

  useEffect(() => {
    if (!workTabCloseRequest) return
    // The paused-run question comes first and is asked once; the
    // unsaved-changes prompt follows whichever way it is answered.
    if (pausedRunForCloseRequest(workTabs, pausedDebug, workTabCloseRequest)) {
      setPausedGate(workTabCloseRequest)
    } else {
      beginClose(workTabCloseRequest)
    }
    consumeWorkTabCloseRequest()
    // performClose/workTabs/workTabDirty/activate*/close* deliberately
    // excluded: this effect fires exactly once per new
    // workTabCloseRequest value (the store's own one-shot signal
    // pattern, mirroring canvasCommandRequest's dispatch effect) --
    // re-running it because an unrelated store field changed would
    // risk double-consuming the same request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workTabCloseRequest])

  const requestClose = useAppStore((s) => s.requestWorkTabClose)
  const workflowLabel = (id: string) => workflows?.find((w) => w.ID === id)?.Label
  const requestLabel = (id: string) => requests?.find((r) => r.ID === id)?.Label

  function answerPausedGate(stop: boolean) {
    const request = pausedGate
    setPausedGate(null)
    if (!request) return
    const run = pausedRun
    const stopped = stop && run
      ? runCommand('run.stop', { kind: 'run', runId: run.runID, workflowId: run.workflowID, nodeId: run.pending?.nodeID })
      : Promise.resolve(true)
    // The close waits for the stop to land: closing first would leave the
    // only surface that knows this run's id gone while the request is
    // still in flight.
    void stopped.then(() => beginClose(request))
  }

  const dialogNode = (() => {
    if (pausedGate && pausedRun) {
      return (
        <StopPausedRunDialog
          title={t('stopPausedRunDialog.leaveTitle')}
          stepLabel={pausedRun.pending?.nodeTypeLabel || pausedRun.pending?.nodeTypeID || ''}
          onStop={() => answerPausedGate(true)}
          onKeep={() => answerPausedGate(false)}
          onCancel={() => setPausedGate(null)}
        />
      )
    }
    if (dialog === null) return null
    if (dialog.kind === 'one') {
      const tab = workTabs.find((t) => t.key === dialog.key)
      if (!tab) return null
      return (
        <CloseTabDialog
          label={tabLabel(tab, workflowLabel, requestLabel, t)}
          onCancel={() => setDialog(null)}
          onDontSave={() => {
            clearScratch(dialog.key)
            closeWorkTab(dialog.key)
            setDialog(null)
          }}
          onSave={() => {
            requestCanvasCommand('save')
            setDialog(null)
          }}
        />
      )
    }
    const isAll = dialog.request.kind === 'all'
    return (
      <ConfirmDialog
        title={isAll ? t('closeTabsDialog.titleAll') : t('closeTabsDialog.titleOthers')}
        body={t('closeTabsDialog.body', { count: dialog.count, plural: dialog.count === 1 ? '' : 's', has: dialog.count === 1 ? 'has' : 'have' })}
        confirmLabel={t('closeTabsDialog.confirm')}
        cancelLabel={t('closeTabsDialog.cancel')}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          performClose(dialog.request)
          setDialog(null)
        }}
      />
    )
  })()

  return { requestClose, dialog: dialogNode }
}
