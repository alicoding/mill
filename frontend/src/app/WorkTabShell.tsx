import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Tabs } from '@primer/react/experimental'
import { ActionList, ActionMenu, Banner, IconButton } from '@primer/react'
import { ChevronDownIcon } from '@primer/octicons-react'
import { ConfigureService } from '../shared/bindings'
import { TabItem, TabList, TabPanel } from '../shared/Tabs'
import { ENTITY_ICON } from '../shared/entityIcons'
import { refreshRequests, refreshWorkflows, useAppStore, type WorkTab } from '../shared/store'
import { WorkflowEditorTab } from '../composition/WorkflowEditorTab'
import { clearScratch } from '../composition/canvasScratch'
import { RequestForm } from '../configure/RequestForm'
import { RequestSummary } from '../configure/RequestSummary'
import editorStyles from '../composition/CompositionView.module.css'
import { tabLabel } from './workTabLabel'
import { HotkeyHint } from './HotkeyHint'
import styles from './WorkTabShell.module.css'

// The ONE app-wide work-tab strip (docs/SPEC.md §3.8, direct user
// decision: two per-page strips isolating open work between pages was
// the wrong model -- the reference platform's own app-wide tab bar is
// the target). The first tab is the sidebar's current section page
// (children); every open work item -- a workflow editor, an
// integration view/edit -- is a tab beside it, surviving section
// switches. Every panel stays mounted-hidden (shared/Tabs' own
// semantics), so canvas edits survive navigating anywhere.
//
// Chrome-style tabs-in-titlebar (owner-requested, "Chrome has the tab
// system at the very top"): the strip itself now RENDERS inside the
// titlebar band App.tsx owns at the very top of .app-shell, above the
// PageLayout row -- not inside PageLayout.Content where it used to
// live. `<Tabs>` is plain React context (@primer/react/experimental's
// TabsContext -- confirmed directly against its compiled source, no
// DOM-adjacency requirement between TabList/TabPanel), so the strip's
// markup is portaled into `titlebarSlot` (a DOM node App.tsx hands
// down, ref'd from the band it renders) while the panels stay in
// normal flow here. The band always exists now -- unlike the old
// workTabs.length>0 gate, which hid the whole strip (page tab
// included) when nothing was open; the titlebar always shows at least
// the page tab, since it IS the titlebar, not optional chrome.

const PAGE_TAB = '__page__'

// The VS Code tab anatomy (owner-requested): every band tab is
// icon + single-line label at ONE constant baseline -- the entity
// glyph (shared/entityIcons.ts, the same kind cue the inventory rows
// use) replaces the two-line kicker, which put labels at varying
// heights inside the 38px band.
function tabEntityVisual(tab: WorkTab): ReactNode {
  const entity = tab.kind.startsWith('workflow') ? 'workflow' : 'request'
  const e = ENTITY_ICON[entity]
  if (!e) return null
  return (
    <span data-testid="tab-icon" data-entity={entity} style={{ color: e.fg, display: 'inline-flex' }}>
      <e.Icon size={14} />
    </span>
  )
}

export function WorkTabShell({ pageLabel, pageIcon, titlebarSlot, children }: { pageLabel: string; pageIcon?: ReactNode; titlebarSlot: HTMLDivElement | null; children: ReactNode }) {
  const workTabs = useAppStore((s) => s.workTabs)
  const activeWorkTabKey = useAppStore((s) => s.activeWorkTabKey)
  const activateWorkTab = useAppStore((s) => s.activateWorkTab)
  const closeWorkTab = useAppStore((s) => s.closeWorkTab)
  const closeAllWorkTabs = useAppStore((s) => s.closeAllWorkTabs)
  const closeOtherWorkTabs = useAppStore((s) => s.closeOtherWorkTabs)
  const openWorkTab = useAppStore((s) => s.openWorkTab)
  const setWorkTabMode = useAppStore((s) => s.setWorkTabMode)
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
        // A 'workflow-new' tab has no view mode -- composing a brand-new
        // workflow is inherently an editing act (docs/goals/0022).
        const mode = tab.kind === 'workflow-edit' ? tab.mode : 'edit'
        return (
          <WorkflowEditorTab
            nodeTypes={nodeTypes}
            workflow={workflow}
            tabKey={tab.key}
            mode={mode}
            onBack={() => closeAndClearScratch(tab.key)}
            onSaved={() => { void refreshWorkflows(); closeWorkTab(tab.key) }}
            onWorkflowsChanged={() => void refreshWorkflows()}
            onSwitchToEdit={() => setWorkTabMode(tab.key, 'edit')}
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

  // The strip's actual markup -- always includes the pinned page tab
  // now (no more workTabs.length>0 gate; the band it portals into IS
  // the titlebar). Portaled into titlebarSlot rather than rendered in
  // place, since the titlebar band lives above PageLayout in App.tsx,
  // not inside PageLayout.Content where this component itself renders.
  const stripContent = (
    <>
      <TabList aria-label="Open work">
        <TabItem value={PAGE_TAB} leadingVisual={pageIcon}>{pageLabel}</TabItem>
        {workTabs.map((t) => (
          <TabItem key={t.key} value={t.key} leadingVisual={tabEntityVisual(t)} onClose={() => closeAndClearScratch(t.key)}>
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
                  {/* Inline hotkey hint (docs/goals/0015) -- reads the
                      SAME registry Settings' Keyboard Shortcuts list
                      reads from, never a second hardcoded copy. */}
                  <ActionList.TrailingVisual>
                    <HotkeyHint commandId="tab.closeOthers" />
                  </ActionList.TrailingVisual>
                </ActionList.Item>
                <ActionList.Item variant="danger" onSelect={closeAllTabs}>
                  Close all tabs
                  <ActionList.TrailingVisual>
                    <HotkeyHint commandId="tab.closeAll" />
                  </ActionList.TrailingVisual>
                </ActionList.Item>
              </ActionList>
            </ActionMenu.Overlay>
          </ActionMenu>
        </div>
      )}
    </>
  )

  return (
    <Tabs value={activeWorkTabKey ?? PAGE_TAB} onValueChange={({ value }) => activateWorkTab(value === PAGE_TAB ? null : value)}>
      {titlebarSlot && createPortal(stripContent, titlebarSlot)}
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
