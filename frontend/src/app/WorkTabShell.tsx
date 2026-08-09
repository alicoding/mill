import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Tabs } from '@primer/react/experimental'
import { ConfigureService } from '../../bindings/github.com/alicoding/mill'
import { TabItem, TabList, TabPanel } from '../shared/Tabs'
import { refreshRequests, refreshWorkflows, useAppStore, type WorkTab } from '../shared/store'
import { WorkflowEditorTab } from '../composition/WorkflowEditorTab'
import { RequestForm } from '../configure/RequestForm'
import { RequestSummary } from '../configure/RequestSummary'
import editorStyles from '../composition/CompositionView.module.css'

// The ONE app-wide work-tab strip (docs/SPEC.md §3.8, direct user
// decision: two per-page strips isolating open work between pages was
// the wrong model -- the reference platform's own app-wide tab bar is
// the target). The first tab is the sidebar's current section page
// (children); every open work item -- a workflow editor, an
// integration view/edit -- is a tab beside it, surviving section
// switches. Every panel stays mounted-hidden (shared/Tabs' own
// semantics), so canvas edits survive navigating anywhere. The strip
// row itself only renders once something is open -- no chrome tax on
// pages with nothing open.

const PAGE_TAB = '__page__'

function tabLabel(tab: WorkTab, workflowLabel: (id: string) => string | undefined, requestLabel: (id: string) => string | undefined): string {
  switch (tab.kind) {
    case 'workflow-edit':
      return workflowLabel(tab.workflowId) ?? 'Workflow'
    case 'workflow-new':
      return 'New workflow'
    case 'request-view':
    case 'request-edit':
      return requestLabel(tab.requestId) ?? 'Integration'
    case 'request-new':
      return 'New integration'
  }
}

export function WorkTabShell({ pageLabel, children }: { pageLabel: string; children: ReactNode }) {
  const workTabs = useAppStore((s) => s.workTabs)
  const activeWorkTabKey = useAppStore((s) => s.activeWorkTabKey)
  const activateWorkTab = useAppStore((s) => s.activateWorkTab)
  const closeWorkTab = useAppStore((s) => s.closeWorkTab)
  const openWorkTab = useAppStore((s) => s.openWorkTab)
  const pruneWorkTabs = useAppStore((s) => s.pruneWorkTabs)
  const workflows = useAppStore((s) => s.workflows)
  const nodeTypes = useAppStore((s) => s.nodeTypes)
  const requests = useAppStore((s) => s.requests)

  // Drop restored tabs whose entity was deleted since last session --
  // once, when both lists are actually in (never against a still-null
  // list, which would wrongly prune everything).
  useEffect(() => {
    if (workflows === null || requests === null) return
    pruneWorkTabs((tab) => {
      if (tab.kind === 'workflow-edit') return workflows.some((w) => w.ID === tab.workflowId)
      if (tab.kind === 'request-view' || tab.kind === 'request-edit') return requests.some((r) => r.ID === tab.requestId)
      return true
    })
  }, [workflows, requests, pruneWorkTabs])

  const workflowLabel = (id: string) => workflows?.find((w) => w.ID === id)?.Label
  const requestLabel = (id: string) => requests?.find((r) => r.ID === id)?.Label

  const renderTab = (tab: WorkTab) => {
    switch (tab.kind) {
      case 'workflow-edit':
      case 'workflow-new': {
        if (nodeTypes === null) return null
        const workflow = tab.kind === 'workflow-edit' ? (workflows?.find((w) => w.ID === tab.workflowId) ?? null) : null
        if (tab.kind === 'workflow-edit' && workflow === null) return null
        return (
          <WorkflowEditorTab
            nodeTypes={nodeTypes}
            workflow={workflow}
            onBack={() => closeWorkTab(tab.key)}
            onSaved={() => { void refreshWorkflows(); closeWorkTab(tab.key) }}
            onWorkflowsChanged={() => void refreshWorkflows()}
          />
        )
      }
      case 'request-view': {
        const request = requests?.find((r) => r.ID === tab.requestId)
        if (!request) return null
        return (
          <RequestSummary
            request={request}
            onEdit={() => openWorkTab({ kind: 'request-edit', requestId: request.ID })}
            onDuplicate={() => openWorkTab({ kind: 'request-new', duplicateFromId: request.ID })}
            onDelete={() => {
              ConfigureService.DeleteHTTPRequest(request.ID)
                .then(() => refreshRequests()) // prune closes this tab once the list lands
                .catch(console.error)
            }}
          />
        )
      }
      case 'request-edit':
      case 'request-new': {
        const editing = tab.kind === 'request-edit' ? (requests?.find((r) => r.ID === tab.requestId) ?? null) : null
        if (tab.kind === 'request-edit' && editing === null) return null
        const duplicateFrom = tab.kind === 'request-new' && tab.duplicateFromId
          ? (requests?.find((r) => r.ID === tab.duplicateFromId) ?? null)
          : null
        return (
          <RequestForm
            editingRequest={editing}
            duplicateFrom={duplicateFrom}
            onSaved={() => { void refreshRequests(); closeWorkTab(tab.key) }}
            onCancel={() => closeWorkTab(tab.key)}
          />
        )
      }
    }
  }

  const isCanvasTab = (tab: WorkTab) => tab.kind === 'workflow-edit' || tab.kind === 'workflow-new'

  return (
    <Tabs value={activeWorkTabKey ?? PAGE_TAB} onValueChange={({ value }) => activateWorkTab(value === PAGE_TAB ? null : value)}>
      {workTabs.length > 0 && (
        <TabList aria-label="Open work">
          <TabItem value={PAGE_TAB}>{pageLabel}</TabItem>
          {workTabs.map((t) => (
            <TabItem key={t.key} value={t.key} onClose={() => closeWorkTab(t.key)}>
              {tabLabel(t, workflowLabel, requestLabel)}
            </TabItem>
          ))}
        </TabList>
      )}
      <TabPanel value={PAGE_TAB}>{children}</TabPanel>
      {workTabs.map((t) => (
        <TabPanel key={t.key} value={t.key} className={isCanvasTab(t) ? editorStyles.editorPanel : undefined}>
          {renderTab(t)}
        </TabPanel>
      ))}
    </Tabs>
  )
}
