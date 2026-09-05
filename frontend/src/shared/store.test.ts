import { describe, expect, it } from 'vitest'
import { activeSection } from './store'
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
