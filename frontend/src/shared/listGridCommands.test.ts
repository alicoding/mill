import { afterEach, describe, expect, it } from 'vitest'
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
    useListGridSearchFocusStore.getState().setFocused({ id: 'grid-1', toggleSearch: () => {} })
    expect(commandAvailable(command, cardCtx)).toBe(false)
  })

  it('is available once a grid holds focus AND the invoker is a grid', () => {
    useListGridSearchFocusStore.getState().setFocused({ id: 'grid-1', toggleSearch: () => {} })
    expect(commandAvailable(command, listGridCtx)).toBe(true)
  })

  it('toggles the focused handle, not some other one, when run', () => {
    let toggled = 0
    useListGridSearchFocusStore.getState().setFocused({ id: 'grid-1', toggleSearch: () => { toggled += 1 } })
    void command.run(listGridCtx)
    expect(toggled).toBe(1)
  })

  it('clears when the mount unpublishes on blur/unmount', () => {
    useListGridSearchFocusStore.getState().setFocused({ id: 'grid-1', toggleSearch: () => {} })
    useListGridSearchFocusStore.getState().clearFocused('grid-1')
    expect(commandAvailable(command, listGridCtx)).toBe(false)
  })
})
