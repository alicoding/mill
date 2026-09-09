import { afterEach, describe, expect, it, vi } from 'vitest'
import { findCommand } from './commands'
import { useListSelectionFocusStore, type ListSelectionHandle } from './listSelectionFocus'

// goal 0404 S1: list.toggleSelection/extendSelection's own
// enabled()/run() wiring -- the Shift/toggle
// branches themselves are proven in listSelectionCore.test.ts's own
// activateCheckbox table; this just pins that the commands read and
// call the FOCUSED list's handle, honestly, the same shape
// list.selectAll's own test would if it had one.
function fakeHandle(overrides: Partial<ListSelectionHandle> = {}): ListSelectionHandle {
  return {
    id: 'fake',
    selectAll: vi.fn(),
    clear: vi.fn(),
    hasSelection: () => false,
    selectedCount: () => 0,
    deleteSelected: vi.fn(),
    toggleFocusedRow: vi.fn(),
    extendFocusedRow: vi.fn(),
    ...overrides,
  }
}

afterEach(() => {
  useListSelectionFocusStore.setState({ focused: null })
})

describe('list.toggleSelection', () => {
  const command = findCommand('list.toggleSelection')!

  it('is unavailable with no list focused', () => {
    expect(command.enabled?.()).toBe(false)
  })

  it('is available once a list is focused, regardless of its own selection', () => {
    useListSelectionFocusStore.getState().setFocused(fakeHandle())
    expect(command.enabled?.()).toBe(true)
  })

  it('calls the focused handle\'s own toggleFocusedRow, not some other one', () => {
    const other = fakeHandle({ id: 'other' })
    const focused = fakeHandle()
    useListSelectionFocusStore.getState().setFocused(other)
    useListSelectionFocusStore.getState().setFocused(focused)
    void command.run()
    expect(focused.toggleFocusedRow).toHaveBeenCalledTimes(1)
    expect(other.toggleFocusedRow).not.toHaveBeenCalled()
  })

  it('carries an extra X binding alongside the default Space', () => {
    expect(command.defaultBinding).toEqual({ mods: [], key: 'Space' })
    expect(command.extraBindings).toEqual([{ mods: [], key: 'X' }])
  })
})

describe('list.extendSelection', () => {
  const command = findCommand('list.extendSelection')!

  it('is unavailable with no list focused', () => {
    expect(command.enabled?.()).toBe(false)
  })

  it('calls the focused handle\'s own extendFocusedRow when run', () => {
    const focused = fakeHandle()
    useListSelectionFocusStore.getState().setFocused(focused)
    void command.run()
    expect(focused.extendFocusedRow).toHaveBeenCalledTimes(1)
  })

  it('binds to Shift+Space', () => {
    expect(command.defaultBinding).toEqual({ mods: ['shift'], key: 'Space' })
  })
})
