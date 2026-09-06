import { afterEach, describe, expect, it, vi } from 'vitest'

const { addListRowAtMock } = vi.hoisted(() => ({ addListRowAtMock: vi.fn() }))

// Only ConfigureService.AddListRowAt is faked; every other binding the
// registry reaches for on import (including ConfigureService's own
// other methods) stays real.
vi.mock('./bindings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./bindings')>()
  return { ...actual, ConfigureService: { ...actual.ConfigureService, AddListRowAt: addListRowAtMock } }
})

import { commandAvailable, findCommand } from './commands'
import type { CommandContext } from './commandContext'
import { useListGridSearchFocusStore } from './listGridSearchFocus'

// listGrid.search's enabled() truth table (goal 0349 S4 gap): needs BOTH
// a listGrid context (the invoker is a grid, not some other surface)
// AND a currently-focused grid's handle published -- either alone is
// not enough, matching output.find's own "no viewer focused, no
// command" shape (outputFocusStore.ts).

const listGridCtx: CommandContext = { kind: 'listGrid', listID: 'list-1', rowIDs: [] }
const cardCtx: CommandContext = { kind: 'card', cardId: 'card-1' }

afterEach(() => {
  useListGridSearchFocusStore.getState().clearFocused('grid-1')
})

describe('listGrid.search enabled() (goal 0349 S4 gap)', () => {
  const command = findCommand('listGrid.search')!

  it('is registered as a hintOnly command bound to the default binding', () => {
    expect(command.hintOnly).toBe(true)
    expect(command.defaultBinding).toEqual({ mods: ['cmd'], key: 'F' })
  })

  it('refuses when no grid is focused, even with a listGrid context', () => {
    expect(commandAvailable(command, listGridCtx)).toBe(false)
  })

  it('refuses a focused grid handed the wrong context kind', () => {
    useListGridSearchFocusStore.getState().setFocused({ id: 'grid-1', toggleSearch: () => {}, insertColumn: () => {} })
    expect(commandAvailable(command, cardCtx)).toBe(false)
  })

  it('is available once a grid holds focus AND the invoker is a grid', () => {
    useListGridSearchFocusStore.getState().setFocused({ id: 'grid-1', toggleSearch: () => {}, insertColumn: () => {} })
    expect(commandAvailable(command, listGridCtx)).toBe(true)
  })

  it('toggles the focused handle, not some other one, when run', () => {
    let toggled = 0
    useListGridSearchFocusStore.getState().setFocused({ id: 'grid-1', toggleSearch: () => { toggled += 1 }, insertColumn: () => {} })
    void command.run(listGridCtx)
    expect(toggled).toBe(1)
  })

  it('clears when the mount unpublishes on blur/unmount', () => {
    useListGridSearchFocusStore.getState().setFocused({ id: 'grid-1', toggleSearch: () => {}, insertColumn: () => {} })
    useListGridSearchFocusStore.getState().clearFocused('grid-1')
    expect(commandAvailable(command, listGridCtx)).toBe(false)
  })
})

// listGrid.addRow (goal 0349 S4 Part B): stateless -- always appends
// at the list's own end via the row door directly, needing no
// focused mount at all.
describe('listGrid.addRow', () => {
  const command = findCommand('listGrid.addRow')!

  it('is available for any listGrid context, with no grid focused', () => {
    expect(commandAvailable(command, listGridCtx)).toBe(true)
  })

  it('refuses a non-listGrid context', () => {
    expect(commandAvailable(command, cardCtx)).toBe(false)
  })

  it('appends a row at the end through the row door', async () => {
    addListRowAtMock.mockReset().mockResolvedValue(undefined)
    await command.run(listGridCtx)
    expect(addListRowAtMock).toHaveBeenCalledWith('list-1', {}, -1)
  })
})

// listGrid.addColumn (goal 0349 S4 Part B): the SAME focused-mount
// shape listGrid.search uses -- only the focused mount's own
// insertColumn can open the new column's rename field.
describe('listGrid.addColumn', () => {
  const command = findCommand('listGrid.addColumn')!

  it('refuses when no grid is focused', () => {
    expect(commandAvailable(command, listGridCtx)).toBe(false)
  })

  it('is available once a grid holds focus AND the invoker is a grid', () => {
    useListGridSearchFocusStore.getState().setFocused({ id: 'grid-1', toggleSearch: () => {}, insertColumn: () => {} })
    expect(commandAvailable(command, listGridCtx)).toBe(true)
  })

  it('inserts a column on the focused handle, not some other one, when run', () => {
    let inserted = 0
    useListGridSearchFocusStore.getState().setFocused({ id: 'grid-1', toggleSearch: () => {}, insertColumn: () => { inserted += 1 } })
    void command.run(listGridCtx)
    expect(inserted).toBe(1)
  })
})
