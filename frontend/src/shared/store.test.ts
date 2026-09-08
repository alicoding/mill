import { afterEach, describe, expect, it } from 'vitest'
import { activeSection, useAppStore } from './store'
import type { View } from './store'
import type { WorkTab } from './workTabs'

// goal 0353: opening a work tab never changes `view` (only
// `activeWorkTabKey`, store.ts's setView/openWorkTab), so the sidebar
// must derive its highlight from the active tab's owning section, not
// `view` alone -- this is the truth table that decision reduces to.

const REVIEW: View = { kind: 'review' }
const SETTINGS: View = { kind: 'settings' }

function state(view: View, workTabs: WorkTab[], activeWorkTabKey: string | null) {
  return { view, workTabs, activeWorkTabKey }
}

describe('activeSection', () => {
  it('falls back to view.kind when no tab is active', () => {
    expect(activeSection(state(REVIEW, [], null))).toBe('review')
  })

  it('falls back to view.kind when activeWorkTabKey names no open tab', () => {
    const tabs: WorkTab[] = [{ key: 'stale', kind: 'workflow-edit', workflowId: 'wf1', mode: 'view' }]
    expect(activeSection(state(REVIEW, tabs, 'gone'))).toBe('review')
  })

  it('maps an active workflow-edit tab to composition, regardless of the underlying page', () => {
    const tabs: WorkTab[] = [{ key: 'k1', kind: 'workflow-edit', workflowId: 'wf1', mode: 'view' }]
    expect(activeSection(state(REVIEW, tabs, 'k1'))).toBe('composition')
  })

  it('maps an active workflow-new tab to composition', () => {
    const tabs: WorkTab[] = [{ key: 'k1', kind: 'workflow-new' }]
    expect(activeSection(state(SETTINGS, tabs, 'k1'))).toBe('composition')
  })

  it('maps an active request-view tab to configure', () => {
    const tabs: WorkTab[] = [{ key: 'k1', kind: 'request-view', requestId: 'r1' }]
    expect(activeSection(state(REVIEW, tabs, 'k1'))).toBe('configure')
  })

  it('maps an active request-edit tab to configure', () => {
    const tabs: WorkTab[] = [{ key: 'k1', kind: 'request-edit', requestId: 'r1' }]
    expect(activeSection(state(REVIEW, tabs, 'k1'))).toBe('configure')
  })

  it('maps an active request-new tab to configure', () => {
    const tabs: WorkTab[] = [{ key: 'k1', kind: 'request-new' }]
    expect(activeSection(state(REVIEW, tabs, 'k1'))).toBe('configure')
  })

  it('falls back to view.kind for a tab kind with no owning sidebar section (plugin-view)', () => {
    const tabs: WorkTab[] = [{ key: 'k1', kind: 'plugin-view', pluginId: 'p1', viewId: 'v1' }]
    expect(activeSection(state(REVIEW, tabs, 'k1'))).toBe('review')
  })

  it('falls back to view.kind for a tab kind with no owning sidebar section (output)', () => {
    const tabs: WorkTab[] = [{ key: 'k1', kind: 'output', outputId: 'o1' }]
    expect(activeSection(state(SETTINGS, tabs, 'k1'))).toBe('settings')
  })
})

// requestFormTestReady (goal 0370): the mirror configure.integration.
// testDraft's enabled() reads, cleared alongside workTabDirty on every
// close path so a closed tab's key never lingers as a false positive.
describe('requestFormTestReady cleanup', () => {
  afterEach(() => {
    useAppStore.setState({ workTabs: [], activeWorkTabKey: null, requestFormTestReady: {} })
  })

  it('closeWorkTab drops the closed tab key', () => {
    useAppStore.setState({
      workTabs: [{ key: 'k1', kind: 'request-edit', requestId: 'r1' }],
      activeWorkTabKey: 'k1',
      requestFormTestReady: { k1: true },
    })
    useAppStore.getState().closeWorkTab('k1')
    expect(useAppStore.getState().requestFormTestReady).toEqual({})
  })

  it('closeOtherWorkTabs keeps only the surviving tab key', () => {
    useAppStore.setState({
      workTabs: [
        { key: 'k1', kind: 'request-edit', requestId: 'r1' },
        { key: 'k2', kind: 'request-edit', requestId: 'r2' },
      ],
      activeWorkTabKey: 'k1',
      requestFormTestReady: { k1: true, k2: true },
    })
    useAppStore.getState().closeOtherWorkTabs('k2')
    expect(useAppStore.getState().requestFormTestReady).toEqual({ k2: true })
  })

  it('closeAllWorkTabs clears every entry', () => {
    useAppStore.setState({
      workTabs: [{ key: 'k1', kind: 'request-edit', requestId: 'r1' }],
      activeWorkTabKey: 'k1',
      requestFormTestReady: { k1: true },
    })
    useAppStore.getState().closeAllWorkTabs()
    expect(useAppStore.getState().requestFormTestReady).toEqual({})
  })
})

// docs/goals/0407-tab-close-activation.md: closeWorkTab only recomputes
// the active tab when the closed tab WAS the active one --
// workTabs.test.ts's nextActiveAfterClose table exhaustively covers the
// pure survivor decision itself; this exercises the store's own guard
// around it, which the pure function cannot express on its own.
describe('closeWorkTab activation (goal 0407)', () => {
  afterEach(() => {
    useAppStore.setState({ workTabs: [], activeWorkTabKey: null, recentWorkTabKeys: [] })
  })

  it('closing an inactive tab leaves the active tab untouched', () => {
    useAppStore.setState({
      workTabs: [
        { key: 'k1', kind: 'request-edit', requestId: 'r1' },
        { key: 'k2', kind: 'request-edit', requestId: 'r2' },
      ],
      activeWorkTabKey: 'k2',
      recentWorkTabKeys: ['k1', 'k2'],
    })
    useAppStore.getState().closeWorkTab('k1')
    expect(useAppStore.getState().activeWorkTabKey).toBe('k2')
  })

  it('closing the active tab activates the most-recently-used survivor', () => {
    useAppStore.setState({
      workTabs: [
        { key: 'k1', kind: 'request-edit', requestId: 'r1' },
        { key: 'k2', kind: 'request-edit', requestId: 'r2' },
        { key: 'k3', kind: 'request-edit', requestId: 'r3' },
      ],
      activeWorkTabKey: 'k3',
      recentWorkTabKeys: ['k1', 'k2', 'k3'],
    })
    useAppStore.getState().closeWorkTab('k3')
    expect(useAppStore.getState().activeWorkTabKey).toBe('k2')
  })
})
