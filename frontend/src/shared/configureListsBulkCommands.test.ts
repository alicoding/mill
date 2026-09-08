import { afterEach, describe, expect, it, vi } from 'vitest'

const { deleteListMock } = vi.hoisted(() => ({ deleteListMock: vi.fn().mockResolvedValue(undefined) }))

vi.mock('./bindings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./bindings')>()
  return { ...actual, ConfigureService: { ...actual.ConfigureService, DeleteList: deleteListMock } }
})

vi.mock('./configureEntityStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./configureEntityStore')>()
  return { ...actual, refreshLists: vi.fn(), refreshListUsage: vi.fn() }
})

import { commandAvailable, commandLabel, findCommand } from './commands'
import type { CommandContext } from './commandContext'

afterEach(() => {
  deleteListMock.mockClear()
})

// configure.lists.deleteUnused's own enablement/label truth table
// (docs/goals/0392 S1, Decision 3's bulk cleanup): honest enablement
// keyed off the invoker's own selection, never a silent inline guard.
describe('configure.lists.deleteUnused', () => {
  const command = findCommand('configure.lists.deleteUnused')!
  const emptySelection: CommandContext = { kind: 'entitySelection', entity: 'list', ids: [] }
  const oneSelected: CommandContext = { kind: 'entitySelection', entity: 'list', ids: ['list-1'] }
  const twoSelected: CommandContext = { kind: 'entitySelection', entity: 'list', ids: ['list-1', 'list-2'] }
  const wrongFamily: CommandContext = { kind: 'entitySelection', entity: 'mcpserver', ids: ['server-1'] }

  it('is hidden from the palette (a live checkbox selection, not a global target)', () => {
    expect(command.paletteHidden).toBe(true)
  })

  it('refuses with no context at all', () => {
    expect(commandAvailable(command, undefined)).toBe(false)
  })

  it('refuses an empty selection', () => {
    expect(commandAvailable(command, emptySelection)).toBe(false)
  })

  it('refuses a selection from a different entity family', () => {
    expect(commandAvailable(command, wrongFamily)).toBe(false)
  })

  it('is available once at least one id is selected', () => {
    expect(commandAvailable(command, oneSelected)).toBe(true)
  })

  it('labels itself with the selected count, singular and plural', () => {
    expect(commandLabel(command, oneSelected)).toBe('Delete 1 list')
    expect(commandLabel(command, twoSelected)).toBe('Delete 2 lists')
  })

  it('deletes every selected id through the existing per-list delete door', async () => {
    await command.run(twoSelected)
    expect(deleteListMock).toHaveBeenCalledTimes(2)
    expect(deleteListMock).toHaveBeenCalledWith('list-1')
    expect(deleteListMock).toHaveBeenCalledWith('list-2')
  })
})
