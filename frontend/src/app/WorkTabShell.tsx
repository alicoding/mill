import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Tabs } from '@primer/react/experimental'
import { ActionList, ActionMenu, Banner, IconButton } from '@primer/react'
import { ChevronDownIcon } from '@primer/octicons-react'
import { ConfigureService } from '../shared/bindings'
import { TabItem, TabList, TabPanel } from '../shared/Tabs'
import { refreshRequests, refreshWorkflows, useAppStore, type WorkTab } from '../shared/store'
import { WorkflowEditorTab } from '../composition/WorkflowEditorTab'
import { clearScratch } from '../composition/canvasScratch'
import { RequestForm } from '../configure/RequestForm'
import { RequestSummary } from '../configure/RequestSummary'
import editorStyles from '../composition/CompositionView.module.css'
import styles from './WorkTabShell.module.css'

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
  const closeAllWorkTabs = useAppStore((s) => s.closeAllWorkTabs)
  const closeOtherWorkTabs = useAppStore((s) => s.closeOtherWorkTabs)
  const openWorkTab = useAppStore((s) => s.openWorkTab)
  const pruneWorkTabs = useAppStore((s) => s.pruneWorkTabs)
  const workflows = useAppStore((s) => s.workflows)
  const nodeTypes = useAppStore((s) => s.nodeTypes)
  const requests = useAppStore((s) => s.requests)
  // Hot-exit signals (docs/goals/0012-authoring-hot-exit.md), written by
  // composition/CompositionCanvas.tsx, read here for the tab-strip dirty
  // dot and the restored-scratch banner.
  const workTabDirty = useAppStore((s) => s.workTabDirty)
  const workTabRestored = useAppStore((s) => s.workTabRestored)
  const dismissWorkTabRestored = useAppStore((s) => s.dismissWorkTabRestored)

  // Deliberate tab close/back (the ✕, or the canvas's own Back arrow)
  // is the other event that discards a canvas tab's hot-exit scratch --
  // wraps closeWorkTab so every path off a work tab funnels through one
  // place. A no-op for tab kinds that never write scratch (Configure
  // forms are out of this goal's scope) since clearing a key that was
  // never written is harmless.
  const closeAndClearScratch = (key: string) => {
    clearScratch(key)
    closeWorkTab(key)
  }

  // Bulk closers for the overflow ⌄ menu (goal 0018). Scratch clearing
  // stays here (the store is scratch-agnostic): clear every key that's
  // about to be removed, then let the store drop them from state.
  const closeAllTabs = () => {
    workTabs.forEach((t) => clearScratch(t.key))
    closeAllWorkTabs()
  }
  const closeOtherTabs = (keepKey: string) => {
    workTabs.forEach((t) => { if (t.key !== keepKey) clearScratch(t.key) })
    closeOtherWorkTabs(keepKey)
  }

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
            tabKey={tab.key}
            onBack={() => closeAndClearScratch(tab.key)}
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
        <div className={styles.tabStrip}>
          <TabList aria-label="Open work">
            <TabItem value={PAGE_TAB}>{pageLabel}</TabItem>
            {workTabs.map((t) => (
              <TabItem key={t.key} value={t.key} onClose={() => closeAndClearScratch(t.key)}>
                {tabLabel(t, workflowLabel, requestLabel)}
                {/* Hot-exit dirty dot (docs/goals/0012) -- this tab's
                    canvas currently differs from what's saved. */}
                {workTabDirty[t.key] && (
                  <span className={editorStyles.dirtyDot} aria-label="Unsaved changes" data-testid="dirty-indicator">
                    {' '}•
                  </span>
                )}
              </TabItem>
            ))}
          </TabList>
          {/* Overflow + management menu (goal 0018): pinned beside the
              scrolling TabList so many open tabs stay ONE row -- jump to
              any open tab by name (reaches ones scrolled off), and close
              others / close all in one action. Shown once there are 2+
              work tabs, where managing them actually matters. */}
          {workTabs.length >= 2 && (
            <div className={styles.overflow}>
              <ActionMenu>
                <ActionMenu.Anchor>
                  <IconButton
                    icon={ChevronDownIcon}
                    aria-label="All open tabs"
                    size="small"
                    variant="invisible"
                    data-testid="work-tab-overflow"
                  />
                </ActionMenu.Anchor>
                <ActionMenu.Overlay>
                  <ActionList>
                    <ActionList.Group>
                      <ActionList.GroupHeading>Open tabs</ActionList.GroupHeading>
                      {workTabs.map((t) => (
                        <ActionList.Item
                          key={t.key}
                          selected={t.key === activeWorkTabKey}
                          onSelect={() => activateWorkTab(t.key)}
                        >
                          {tabLabel(t, workflowLabel, requestLabel)}
                        </ActionList.Item>
                      ))}
                    </ActionList.Group>
                    <ActionList.Divider />
                    <ActionList.Item
                      disabled={activeWorkTabKey === null}
                      onSelect={() => { if (activeWorkTabKey) closeOtherTabs(activeWorkTabKey) }}
                    >
                      Close other tabs
                    </ActionList.Item>
                    <ActionList.Item variant="danger" onSelect={closeAllTabs}>
                      Close all tabs
                    </ActionList.Item>
                  </ActionList>
                </ActionMenu.Overlay>
              </ActionMenu>
            </div>
          )}
        </div>
      )}
      <TabPanel value={PAGE_TAB}>{children}</TabPanel>
      {workTabs.map((t) => (
        <TabPanel key={t.key} value={t.key} className={isCanvasTab(t) ? editorStyles.editorPanel : undefined}>
          {/* Hot-exit "restored" banner (docs/goals/0012) -- shown only
              for a tab whose canvas was seeded from a pre-reload/quit
              scratch that differed from what's saved. Dismissing it is
              purely informational: the scratch itself keeps shadowing
              the draft until Save or a deliberate close, and the tab
              stays marked dirty. */}
          {isCanvasTab(t) && workTabRestored[t.key] && (
            <Banner
              variant="info"
              title="Unsaved changes restored"
              description="This workflow had unsaved edits from before Mill last closed or reloaded — they're back, not yet saved."
              onDismiss={() => dismissWorkTabRestored(t.key)}
              data-testid="restored-unsaved"
            />
          )}
          {renderTab(t)}
        </TabPanel>
      ))}
    </Tabs>
  )
}
