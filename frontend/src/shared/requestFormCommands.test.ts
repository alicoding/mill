import { afterEach, describe, expect, it } from 'vitest'
import { findCommand } from './commands'
import { useAppStore } from './store'

// The Integration author form's Test action (goal 0370): enabled()
// mirrors the URL-non-empty gate the form's own Test button disables
// on, mediated by the requestFormTestReady store mirror since
// shared/commands.ts can't import configure/RequestForm.tsx directly.
const TAB = { key: 'req-tab-1', kind: 'request-edit' as const, requestId: 'req-1' }

afterEach(() => {
  useAppStore.setState({ workTabs: [], activeWorkTabKey: null, requestFormTestReady: {} })
})

describe('configure.integration.testDraft', () => {
  it('is unavailable with no request tab active', () => {
    expect(findCommand('configure.integration.testDraft')?.enabled?.()).toBe(false)
  })

  it('is unavailable while the active tab has not marked its draft ready (empty URL)', () => {
    useAppStore.setState({ workTabs: [TAB], activeWorkTabKey: TAB.key, requestFormTestReady: {} })
    expect(findCommand('configure.integration.testDraft')?.enabled?.()).toBe(false)
  })

  it('is enabled once the active tab marks its draft ready', () => {
    useAppStore.setState({ workTabs: [TAB], activeWorkTabKey: TAB.key, requestFormTestReady: { [TAB.key]: true } })
    expect(findCommand('configure.integration.testDraft')?.enabled?.()).toBe(true)
  })

  it('ignores a ready flag left over from a tab that is no longer active', () => {
    useAppStore.setState({ workTabs: [TAB], activeWorkTabKey: null, requestFormTestReady: { [TAB.key]: true } })
    expect(findCommand('configure.integration.testDraft')?.enabled?.()).toBe(false)
  })

  it('run() sets the requestFormCommandRequest signal the active RequestForm tab consumes', () => {
    useAppStore.setState({ workTabs: [TAB], activeWorkTabKey: TAB.key, requestFormTestReady: { [TAB.key]: true } })
    void findCommand('configure.integration.testDraft')?.run()
    expect(useAppStore.getState().requestFormCommandRequest).toBe('test')
    useAppStore.getState().consumeRequestFormCommandRequest()
    expect(useAppStore.getState().requestFormCommandRequest).toBeNull()
  })

  it('claims no default keyboard binding', () => {
    expect(findCommand('configure.integration.testDraft')?.defaultBinding).toBeNull()
  })
})
