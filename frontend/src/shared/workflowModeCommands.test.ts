import { afterEach, describe, expect, it } from 'vitest'
import { findCommand, runCommand } from './commands'
import { useAppStore } from './store'

// The mode switch is two commands, not a toggle (goal 0328): the header's
// segmented control renders one segment per command, and a segment is
// selected exactly when its own command is the unavailable one. These
// assertions are what stop the two drifting into a state where both
// segments are live, or neither is.
const TAB = { key: 'tab-1', kind: 'workflow-edit' as const, workflowId: 'wf-1' }

function openTab(mode: 'view' | 'edit') {
  useAppStore.setState({ workTabs: [{ ...TAB, mode }], activeWorkTabKey: TAB.key })
}

afterEach(() => {
  useAppStore.setState({ workTabs: [], activeWorkTabKey: null })
})

describe('workflow.view / workflow.edit', () => {
  it('offers exactly the mode the tab is NOT in', () => {
    openTab('view')
    expect(findCommand('workflow.edit')?.enabled?.()).toBe(true)
    expect(findCommand('workflow.view')?.enabled?.()).toBe(false)

    openTab('edit')
    expect(findCommand('workflow.edit')?.enabled?.()).toBe(false)
    expect(findCommand('workflow.view')?.enabled?.()).toBe(true)
  })

  it('switches the active tab in place, never opening a second one', async () => {
    openTab('view')
    await runCommand('workflow.edit')
    expect(useAppStore.getState().workTabs).toEqual([{ ...TAB, mode: 'edit' }])

    await runCommand('workflow.view')
    expect(useAppStore.getState().workTabs).toEqual([{ ...TAB, mode: 'view' }])
  })

  it('refuses to run when the mode is already in force, so a click on the selected segment is inert', async () => {
    openTab('edit')
    expect(await runCommand('workflow.edit')).toBe(false)
    expect(useAppStore.getState().workTabs[0]).toMatchObject({ mode: 'edit' })
  })

  it('is unavailable with no workflow editor tab open at all', () => {
    expect(findCommand('workflow.view')?.enabled?.()).toBe(false)
    expect(findCommand('workflow.edit')?.enabled?.()).toBe(false)
  })

  it('neither claims a keyboard binding', () => {
    expect(findCommand('workflow.view')?.defaultBinding).toBeNull()
    expect(findCommand('workflow.edit')?.defaultBinding).toBeNull()
  })
})

describe('workflow.runStepped', () => {
  it('signals the active canvas rather than starting a run of its own', async () => {
    openTab('edit')
    await runCommand('workflow.runStepped')
    expect(useAppStore.getState().canvasCommandRequest).toBe('runStepped')
    useAppStore.getState().consumeCanvasCommandRequest()
  })

  it('is unavailable with no workflow editor tab open', () => {
    expect(findCommand('workflow.runStepped')?.enabled?.()).toBe(false)
  })
})
