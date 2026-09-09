import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPluginStorage, type PluginStorageDoors } from './pluginStorage'

describe('buildPluginStorage', () => {
  let doors: PluginStorageDoors
  let setDoor: ReturnType<typeof vi.fn<PluginStorageDoors['set']>>
  let deleteDoor: ReturnType<typeof vi.fn<PluginStorageDoors['delete']>>

  beforeEach(() => {
    setDoor = vi.fn(() => Promise.resolve())
    deleteDoor = vi.fn(() => Promise.resolve())
    doors = { set: setDoor, delete: deleteDoor }
  })

  it('seeds from the snapshot literals, skipping an unreadable one', () => {
    const s = buildPluginStorage('p', { pencil: '{"color":"#da3633","size":4}', n: '3', bad: '{oops' }, doors)
    expect(s.get('pencil')).toEqual({ color: '#da3633', size: 4 })
    expect(s.get('n')).toBe(3)
    expect(s.get('bad')).toBeUndefined()
    expect(s.keys().sort()).toEqual(['n', 'pencil'])
  })

  it('set writes through the door with the decoded value and its literal, and is readable at once; delete removes and writes through', async () => {
    const s = buildPluginStorage('p', {}, doors)
    await s.set('k', { a: [1, 2] })
    expect(s.get('k')).toEqual({ a: [1, 2] })
    expect(setDoor).toHaveBeenCalledWith('k', { a: [1, 2] }, '{"a":[1,2]}')
    await s.delete('k')
    expect(s.get('k')).toBeUndefined()
    expect(deleteDoor).toHaveBeenCalledWith('k')
  })

  it('refuses a value that cannot be stored, without touching the cache or the door', async () => {
    const s = buildPluginStorage('p', {}, doors)
    await expect(s.set('f', () => 1)).rejects.toThrow(/JSON-serialisable/)
    await expect(s.set('n', null)).rejects.toThrow(/not null/)
    expect(s.keys()).toEqual([])
    expect(setDoor).not.toHaveBeenCalled()
  })

  it('getList answers [] for an absent or non-array key', async () => {
    const s = buildPluginStorage('p', { notAList: '3' }, doors)
    await expect(s.getList('missing')).resolves.toEqual([])
    await expect(s.getList('notAList')).resolves.toEqual([])
  })

  it('pushList unshifts, dedupes by the given key, and trims to max', async () => {
    const s = buildPluginStorage('p', {}, doors)
    await s.pushList('history', { url: 'a' })
    await s.pushList('history', { url: 'b' })
    await s.pushList('history', { url: 'a' }, { dedupeBy: (i) => (i as { url: string }).url, max: 5 })
    await expect(s.getList('history')).resolves.toEqual([{ url: 'a' }, { url: 'b' }])

    await s.pushList('history', { url: 'c' }, { max: 2 })
    await expect(s.getList('history')).resolves.toEqual([{ url: 'c' }, { url: 'a' }])
    expect(setDoor).toHaveBeenLastCalledWith('history', [{ url: 'c' }, { url: 'a' }], JSON.stringify([{ url: 'c' }, { url: 'a' }]))
  })
})
