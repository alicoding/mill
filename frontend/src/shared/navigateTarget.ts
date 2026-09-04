import type { View } from './store'
import type { WorkTabSpec } from './workTabs'

// The main window's navigation targets, as the Quick Panel / tray
// panel hand them to SettingsService.OpenMainWindow (Go re-emits the
// string as the 'mill-navigate' event). Pure so the grammar is
// unit-tested; useMillNavigate.ts applies the result.
//
//   settings | review | configure:<tab> | atlas:<cardID>
//   workflow:<id>                -- the workflow's canvas, read-only
//   workflow:<id>:run:<runId>    -- same, showing that run's steps
//   workflow:<id>:run:latest     -- same, showing its newest run
export type NavigateAction = { view: View } | { workTab: WorkTabSpec }

export function parseNavigateTarget(target: string): NavigateAction | null {
  if (target === 'settings') return { view: { kind: 'settings' } }
  if (target === 'review') return { view: { kind: 'review' } }
  if (target.startsWith('configure:')) return { view: { kind: 'configure', tab: target.slice('configure:'.length) } }
  if (target.startsWith('atlas:')) return { view: { kind: 'atlas', cardID: target.slice('atlas:'.length) } }
  if (target.startsWith('workflow:')) {
    const rest = target.slice('workflow:'.length)
    const runAt = rest.indexOf(':run:')
    const workflowId = runAt >= 0 ? rest.slice(0, runAt) : rest
    const runId = runAt >= 0 ? rest.slice(runAt + ':run:'.length) : ''
    if (!workflowId) return null
    return { workTab: { kind: 'workflow-edit', workflowId, mode: 'view', ...(runId ? { runId } : {}) } }
  }
  return null
}

export function workflowTarget(workflowId: string, runId?: string): string {
  return runId ? `workflow:${workflowId}:run:${runId}` : `workflow:${workflowId}`
}
