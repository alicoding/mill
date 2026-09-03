import { describe, expect, it } from 'vitest'
import { useUndoDeleteStore } from './undoDeleteStore'

describe('undoDeleteStore', () => {
  it('a newer delete replaces the toast, and a stale timer never clears its successor', () => {
    const { show, dismiss } = useUndoDeleteStore.getState()
    const noop = async () => {}
    show({ key: 'list/a', message: 'Deleted a', undo: noop })
    show({ key: 'list/b', message: 'Deleted b', undo: noop })
    expect(useUndoDeleteStore.getState().pending?.key).toBe('list/b')
    dismiss('list/a')
    expect(useUndoDeleteStore.getState().pending?.key).toBe('list/b')
    dismiss('list/b')
    expect(useUndoDeleteStore.getState().pending).toBeNull()
    show({ key: 'list/c', message: 'Deleted c', undo: noop })
    dismiss()
    expect(useUndoDeleteStore.getState().pending).toBeNull()
  })
})
