import { afterEach, describe, expect, it, vi } from 'vitest'

const { beginMock, endMock } = vi.hoisted(() => ({ beginMock: vi.fn().mockResolvedValue(undefined), endMock: vi.fn().mockResolvedValue(undefined) }))

vi.mock('./bindings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./bindings')>()
  return { ...actual, AtlasService: { ...actual.AtlasService, BeginUndoMark: beginMock, EndUndoMark: endMock } }
})

import { bulkDeleteWithUndo } from './bulkDeleteWithUndo'
import { useUndoDeleteStore } from './undoDeleteStore'

afterEach(() => {
  beginMock.mockClear()
  endMock.mockClear()
  useUndoDeleteStore.getState().dismiss()
})

const items = [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }]

describe('bulkDeleteWithUndo', () => {
  it('wraps the whole loop in exactly one Begin/EndUndoMark pair (one journal mark for the whole selection)', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    await bulkDeleteWithUndo({ entity: 'list', items, remove, refetch: vi.fn(), journal: { kind: () => 'configure-entity', id: (id) => `list/${id}` } })
    expect(beginMock).toHaveBeenCalledTimes(1)
    expect(endMock).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledTimes(3)
  })

  it('a refusal is kept and reported by name; every other item still deletes (continue, never stop at the first)', async () => {
    const remove = vi.fn(async (id: string) => {
      if (id === 'b') throw new Error('list "Beta" is still referenced')
    })
    const outcome = await bulkDeleteWithUndo({ entity: 'list', items, remove, refetch: vi.fn(), journal: { kind: () => 'configure-entity', id: (id) => `list/${id}` } })
    expect(outcome.deleted).toEqual(['a', 'c'])
    expect(outcome.kept).toEqual([{ id: 'b', label: 'Beta' }])
    expect(remove).toHaveBeenCalledTimes(3)
    expect(endMock).toHaveBeenCalledTimes(1)
  })

  it('refetches once after the whole batch, not once per item', async () => {
    const refetch = vi.fn()
    await bulkDeleteWithUndo({ entity: 'list', items, remove: vi.fn().mockResolvedValue(undefined), refetch, journal: { kind: () => 'configure-entity', id: (id) => `list/${id}` } })
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('posts an undo toast naming the kept item when a journal door is given', async () => {
    const remove = vi.fn(async (id: string) => {
      if (id === 'b') throw new Error('refused')
    })
    await bulkDeleteWithUndo({ entity: 'list', items, remove, refetch: vi.fn(), journal: { kind: () => 'configure-entity', id: (id) => `list/${id}` } })
    const pending = useUndoDeleteStore.getState().pending
    expect(pending?.message).toBe('Deleted 2 lists. 1 kept: still in use (Beta).')
    expect(pending?.undo).not.toBeNull()
    expect(pending?.journalKind).toBe('configure-entity')
    expect(pending?.journalId).toBe('list/c')
  })

  it('posts a toast with NO undo when journal is null (Secrets, goal 0404 S1 amendment)', async () => {
    await bulkDeleteWithUndo({ entity: 'secret', items, remove: vi.fn().mockResolvedValue(undefined), refetch: vi.fn(), journal: null })
    const pending = useUndoDeleteStore.getState().pending
    expect(pending?.message).toBe('Deleted 3 secrets.')
    expect(pending?.undo).toBeNull()
  })

  it('posts nothing when every item is refused (nothing was deleted)', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('refused'))
    await bulkDeleteWithUndo({ entity: 'list', items, remove, refetch: vi.fn(), journal: { kind: () => 'configure-entity', id: (id) => `list/${id}` } })
    expect(useUndoDeleteStore.getState().pending).toBeNull()
  })

  it('names up to three kept items, then falls back to "and N more"', async () => {
    const many = [
      { id: '1', label: 'One' }, { id: '2', label: 'Two' }, { id: '3', label: 'Three' },
      { id: '4', label: 'Four' }, { id: '5', label: 'Five' },
    ]
    const keepOneOk = vi.fn(async (id: string) => { if (id !== '1') throw new Error('refused') })
    const outcome = await bulkDeleteWithUndo({ entity: 'list', items: many, remove: keepOneOk, refetch: vi.fn(), journal: { kind: () => 'configure-entity', id: (id) => `list/${id}` } })
    expect(outcome.kept).toHaveLength(4)
    const pending = useUndoDeleteStore.getState().pending
    expect(pending?.message).toBe('Deleted 1 list. 4 kept: still in use (Two, Three, Four, and 1 more).')
  })
})
