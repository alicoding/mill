import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COMMANDS, commandAvailable, findCommand, runCommand, type Command } from './commands'
import { contextSatisfies } from './commandContext'
import { ambientContext } from './ambientContext'
import { contextMenuItemAvailable, contextMenuItemLabel, visibleContextMenuItems } from './contextMenuItem'
import { menuActionAvailable, menuActionLabel, visibleMenuActions } from './inventoryItem'
import { useAppStore } from './store'
import { useNoticeStore } from './noticeStore'

// Goal 0343: a command takes the TARGET its invoker supplies, and the
// same context reaches both enabled() and run(). These pin the three
// properties every surface depends on -- the context reaches both
// halves, a `needs` command refuses to run without one (silently), and
// unavailable means ABSENT in every menu.

function withCommand<T>(command: Command, body: () => T): T {
  COMMANDS.push(command)
  try {
    return body()
  } finally {
    COMMANDS.splice(COMMANDS.indexOf(command), 1)
  }
}

describe('contextSatisfies', () => {
  it('accepts anything for a command declaring no target', () => {
    expect(contextSatisfies(undefined, undefined)).toBe(true)
    expect(contextSatisfies(undefined, { kind: 'run', runId: 'r' })).toBe(true)
  })

  it('requires the declared kind, exactly', () => {
    expect(contextSatisfies('run', { kind: 'run', runId: 'r' })).toBe(true)
    expect(contextSatisfies('run', { kind: 'workflow', workflowId: 'w' })).toBe(false)
    expect(contextSatisfies('run', undefined)).toBe(false)
  })
})

describe('runCommand with a context', () => {
  beforeEach(() => {
    useNoticeStore.setState({ notices: [] })
  })

  it('passes the same context to enabled() and run()', async () => {
    const enabled = vi.fn(() => true)
    const run = vi.fn()
    const ctx = { kind: 'run' as const, runId: 'run-9', workflowId: 'wf-9' }
    await withCommand({ id: 'test.ctx', label: 'test', defaultBinding: null, enabled, run }, () => runCommand('test.ctx', ctx))
    expect(enabled).toHaveBeenCalledWith(ctx)
    expect(run).toHaveBeenCalledWith(ctx)
  })

  it('refuses a needs-declaring command with no matching context, without a notice', async () => {
    const run = vi.fn()
    const ran = await withCommand({ id: 'test.needs', label: 'test', defaultBinding: null, needs: 'run', run }, () =>
      runCommand('test.needs'),
    )
    expect(ran).toBe(false)
    expect(run).not.toHaveBeenCalled()
    // Nothing was asked of a target -- that is not a failure to report.
    expect(useNoticeStore.getState().notices).toEqual([])
  })

  it('refuses a needs-declaring command handed the wrong kind', async () => {
    const run = vi.fn()
    const ran = await withCommand({ id: 'test.needs2', label: 'test', defaultBinding: null, needs: 'run', run }, () =>
      runCommand('test.needs2', { kind: 'workflow', workflowId: 'wf-1' }),
    )
    expect(ran).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('the row commands', () => {
  beforeEach(() => {
    useAppStore.setState({ pinnedWorkflowIds: [] })
  })

  it('opens a run in its workflow tab, with that run preselected', async () => {
    const requestOpenWorkflow = vi.fn()
    useAppStore.setState({ requestOpenWorkflow })
    await runCommand('run.open', { kind: 'run', runId: 'run-3', workflowId: 'wf-3' })
    expect(requestOpenWorkflow).toHaveBeenCalledWith('wf-3', 'run-3')
  })

  it('cannot open a run whose workflow is unknown -- no tab to open', () => {
    expect(commandAvailable(findCommand('run.open')!, { kind: 'run', runId: 'run-3' })).toBe(false)
    expect(commandAvailable(findCommand('run.open')!, { kind: 'run', runId: 'run-3', workflowId: 'wf-3' })).toBe(true)
  })

  it('offers Pin or Unpin for a workflow, never both', () => {
    const ctx = { kind: 'workflow' as const, workflowId: 'wf-4' }
    expect(commandAvailable(findCommand('workflow.pin')!, ctx)).toBe(true)
    expect(commandAvailable(findCommand('workflow.unpin')!, ctx)).toBe(false)
    useAppStore.setState({ pinnedWorkflowIds: ['wf-4'] })
    expect(commandAvailable(findCommand('workflow.pin')!, ctx)).toBe(false)
    expect(commandAvailable(findCommand('workflow.unpin')!, ctx)).toBe(true)
  })

  it('offers Pin or Unpin for a clipboard entry off the context the surface states', () => {
    expect(commandAvailable(findCommand('clipboard.pin')!, { kind: 'entry', entryId: 'e1' })).toBe(true)
    expect(commandAvailable(findCommand('clipboard.unpin')!, { kind: 'entry', entryId: 'e1' })).toBe(false)
    expect(commandAvailable(findCommand('clipboard.pin')!, { kind: 'entry', entryId: 'e1', pinned: true })).toBe(false)
    expect(commandAvailable(findCommand('clipboard.unpin')!, { kind: 'entry', entryId: 'e1', pinned: true })).toBe(true)
  })

  it('keeps every target command out of the menu bar -- a menu has no row to point at', () => {
    for (const id of ['run.open', 'run.stop', 'run.monitor', 'workflow.open', 'workflow.pin', 'workflow.unpin', 'clipboard.pin', 'clipboard.unpin', 'clipboard.delete']) {
      expect(findCommand(id)?.menu).toBeUndefined()
    }
  })
})

describe('ambientContext', () => {
  beforeEach(() => {
    useAppStore.setState({ workTabs: [], activeWorkTabKey: null, view: { kind: 'home' } })
  })

  it('resolves the active workflow editor tab', () => {
    useAppStore.setState({
      workTabs: [{ key: 'k1', kind: 'workflow-edit', workflowId: 'wf-7', mode: 'edit' }],
      activeWorkTabKey: 'k1',
    })
    expect(ambientContext()).toEqual({ kind: 'workflow', workflowId: 'wf-7' })
  })

  it('resolves the Atlas card being viewed when no editor tab is active', () => {
    useAppStore.setState({ view: { kind: 'atlas', cardID: 'card-2' } })
    expect(ambientContext()).toEqual({ kind: 'card', cardId: 'card-2' })
  })

  it('resolves nothing on a plain view -- a run and a clipboard entry are never ambient', () => {
    useAppStore.setState({ view: { kind: 'review' } })
    expect(ambientContext()).toBeUndefined()
  })
})

describe('menus omit what cannot run', () => {
  it('drops a context-menu item whose command is unavailable for its target', () => {
    useAppStore.setState({ pinnedWorkflowIds: [] })
    const ctx = { kind: 'workflow' as const, workflowId: 'wf-8' }
    expect(contextMenuItemAvailable({ id: 'a', commandId: 'workflow.pin', ctx })).toBe(true)
    expect(contextMenuItemAvailable({ id: 'b', commandId: 'workflow.unpin', ctx })).toBe(false)
    // An item with no command has no enablement to check.
    expect(contextMenuItemAvailable({ id: 'c', label: 'Plain', run: () => {} })).toBe(true)
    // An item pairing a commandId with its OWN closure (goal 0075's
    // label-sharing shape) keeps the surface's enablement, never the
    // command's -- the command it names acts on a selection the
    // registry cannot see.
    expect(contextMenuItemAvailable({ id: 'd', commandId: 'workflow.unpin', ctx, run: () => {} })).toBe(true)
  })

  it('resolves an item label from the registry, not the raw locale key', () => {
    expect(contextMenuItemLabel({ id: 'a', commandId: 'run.open' })).toBe('Open run')
    expect(contextMenuItemLabel({ id: 'b', commandId: 'run.open', label: 'Custom' })).toBe('Custom')
  })

  it('drops a divider left dangling by an omitted item', () => {
    useAppStore.setState({ pinnedWorkflowIds: [] })
    const ctx = { kind: 'workflow' as const, workflowId: 'wf-8' }
    const items = visibleContextMenuItems([
      { id: 'open', commandId: 'workflow.open', ctx },
      { id: 'd1', divider: true },
      { id: 'unpin', commandId: 'workflow.unpin', ctx },
    ])
    expect(items.map((i) => i.id)).toEqual(['open'])
  })

  it('drops an inventory kebab action whose command is unavailable', () => {
    useAppStore.setState({ pinnedWorkflowIds: ['wf-8'] })
    const ctx = { kind: 'workflow' as const, workflowId: 'wf-8' }
    const actions = visibleMenuActions([
      { commandId: 'workflow.pin', ctx },
      { commandId: 'workflow.unpin', ctx },
      // A row's own label overrides the command's, and says nothing
      // about availability.
      { commandId: 'workflow.unpin', ctx, label: 'Unpin this' },
    ])
    expect(actions.map(menuActionLabel)).toEqual(['Unpin', 'Unpin this'])
    expect(menuActionAvailable({ commandId: 'no.such.command', ctx })).toBe(false)
  })
})
