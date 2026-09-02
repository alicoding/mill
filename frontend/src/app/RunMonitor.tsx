import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Text } from '@primer/react'
import { Events } from '@wailsio/runtime'
import { SettingsService } from '../shared/bindings'
import { refreshNodeTypes, refreshWorkflows, useAppStore } from '../shared/store'
import CompositionCanvas from '../composition/CompositionCanvas'
import { workflowTarget } from './navigateTarget'
import styles from './RunMonitor.module.css'

// One workflow's canvas, read-only, showing one run's steps (goal 0294
// S2): the "watch it step" surface that is NOT the full app. Reached
// from the Quick Panel's Run and watch and the tray's Recent rows via
// SettingsService.ShowRunMonitor, which emits the target below before
// showing the window. "Open in Mill" hands the same run to the main
// window and hides this one.
interface Target { workflowID: string; runID: string }

// Server mode has no window and no event: the same target rides the
// hash ('#/runmonitor?workflow=<id>&run=<runId|latest>'), which is how
// the e2e reaches the surface.
function targetFromHash(): Target | null {
  const query = window.location.hash.split('?')[1]
  if (!query) return null
  const params = new URLSearchParams(query)
  const workflowID = params.get('workflow')
  return workflowID ? { workflowID, runID: params.get('run') || 'latest' } : null
}

export function RunMonitor() {
  const { t } = useTranslation('app')
  const [target, setTarget] = useState<Target | null>(targetFromHash)
  const nodeTypes = useAppStore((s) => s.nodeTypes)
  const workflows = useAppStore((s) => s.workflows)

  useEffect(() => {
    return Events.On('mill-run-monitor', (evt) => {
      const data = evt.data as Target
      if (data?.workflowID) setTarget({ workflowID: data.workflowID, runID: data.runID || 'latest' })
    })
  }, [])

  // Its own window, its own JS context: the main window's fetches never
  // reach here (QuickPanel.tsx's per-window pattern).
  useEffect(() => {
    void refreshNodeTypes()
    void refreshWorkflows()
  }, [target?.workflowID])

  const workflow = workflows?.find((w) => w.ID === target?.workflowID) ?? null

  const openInMill = () => {
    if (!target) return
    void SettingsService.HideRunMonitor().catch(() => {})
    void SettingsService.OpenMainWindow(workflowTarget(target.workflowID, target.runID)).catch(() => {})
  }

  return (
    <div className={styles.monitor} data-testid="run-monitor">
      <div className={styles.header}>
        <Text weight="semibold" className={styles.title} data-testid="run-monitor-title">
          {workflow ? workflow.Label : t('runMonitor.title')}
        </Text>
        <Button size="small" onClick={openInMill} disabled={!target} data-testid="run-monitor-open-in-mill">
          {t('runMonitor.openInMill')}
        </Button>
      </div>
      {!target && (
        <Text as="p" size="small" className={styles.empty} data-testid="run-monitor-empty">{t('runMonitor.empty')}</Text>
      )}
      {target && (!workflow || !nodeTypes) && (
        <Text as="p" size="small" className={styles.empty}>{t('runMonitor.loading')}</Text>
      )}
      {target && workflow && nodeTypes && (
        <div className={styles.canvas}>
          <CompositionCanvas
            key={`${workflow.ID}:${target.runID}`}
            nodeTypes={nodeTypes}
            workflow={workflow}
            tabKey={`runmonitor:${workflow.ID}`}
            readOnly
            viewer
            requestedRunId={target.runID}
            onBack={() => { void SettingsService.HideRunMonitor().catch(() => {}) }}
            onSaved={() => {}}
          />
        </div>
      )}
    </div>
  )
}
