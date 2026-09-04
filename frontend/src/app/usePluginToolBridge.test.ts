import { describe, expect, it, vi, beforeEach } from 'vitest'

const emit = vi.fn()
vi.mock('@wailsio/runtime', () => ({ Events: { Emit: (...args: unknown[]) => emit(...args), On: () => () => undefined } }))

const findCommand = vi.fn()
// commandLabel is the real one (it resolves a label key through
// shared/copy.ts, and a plugin's plain-English label passes straight
// through) -- only the registry lookup is mocked here.
vi.mock('../shared/commands', async (orig) => ({
  ...(await orig<typeof import('../shared/commands')>()),
  findCommand: (id: string) => findCommand(id),
}))

const { runPluginCommand } = await import('./usePluginToolBridge')

function lastReply(): Record<string, string> {
  return emit.mock.calls[emit.mock.calls.length - 1][1] as Record<string, string>
}

describe('the plugin tool bridge answers every invoke', () => {
  beforeEach(() => {
    emit.mockClear()
    findCommand.mockReset()
  })

  it('runs the registered command and reports it', () => {
    const run = vi.fn()
    findCommand.mockReturnValue({ id: 'plugin.mill-index.refresh', label: 'Refresh the board index', run })
    runPluginCommand({ requestId: 'r1', pluginId: 'mill-index', commandId: 'refresh' })
    expect(findCommand).toHaveBeenCalledWith('plugin.mill-index.refresh')
    expect(run).toHaveBeenCalledOnce()
    expect(lastReply()).toEqual({ requestId: 'r1', ok: 'true', result: 'ran "Refresh the board index"', error: '' })
  })

  it('reports an unregistered command rather than staying silent', () => {
    findCommand.mockReturnValue(undefined)
    runPluginCommand({ requestId: 'r2', pluginId: 'mill-index', commandId: 'ghost' })
    expect(lastReply().ok).toBe('false')
    expect(lastReply().error).toContain('no command "ghost"')
  })

  it('honours the command\'s own enablement', () => {
    const run = vi.fn()
    findCommand.mockReturnValue({ id: 'x', label: 'Refresh', enabled: () => false, run })
    runPluginCommand({ requestId: 'r3', pluginId: 'mill-index', commandId: 'refresh' })
    expect(run).not.toHaveBeenCalled()
    expect(lastReply().error).toContain('not available right now')
  })

  it('reports what the command threw', () => {
    findCommand.mockReturnValue({ id: 'x', label: 'Refresh', run: () => { throw new Error('nothing to refresh') } })
    runPluginCommand({ requestId: 'r4', pluginId: 'mill-index', commandId: 'refresh' })
    expect(lastReply()).toMatchObject({ ok: 'false', error: 'nothing to refresh' })
  })
})
