import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { dirtyKeysForCloseRequest } from '../shared/workTabs'
import type { WorkTabCloseRequest } from '../shared/store'
import { useAppStore } from '../shared/store'
import { clearScratch } from '../composition/canvasScratch'
import { CloseTabDialog } from './CloseTabDialog'
import { ConfirmDialog } from '../shared/ConfirmDialog'
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

  useEffect(() => {
    if (!workTabCloseRequest) return
    const dirtyKeys = dirtyKeysForCloseRequest(workTabs, workTabDirty, workTabCloseRequest)
    if (dirtyKeys.length === 0) {
      performClose(workTabCloseRequest)
    } else if (workTabCloseRequest.kind === 'one') {
      // The tab activates before prompting (VS Code's own dirty-close
      // convention) -- Save has to reach the ACTIVE tab's canvas
      // (composition/useCanvasCommandDispatch.ts only acts for the
      // active work tab), and the prompt itself should show over the
      // tab it's actually asking about.
      if (activeWorkTabKey !== workTabCloseRequest.key) activateWorkTab(workTabCloseRequest.key)
      setDialog({ kind: 'one', key: workTabCloseRequest.key })
    } else {
      setDialog({ kind: 'bulk', request: workTabCloseRequest, count: dirtyKeys.length })
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

  const dialogNode = (() => {
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
