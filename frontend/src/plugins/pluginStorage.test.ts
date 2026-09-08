import { beforeEach, describe, expect, it, vi } from 'vitest'

const setValue = vi.fn<(...args: string[]) => Promise<void>>(() => Promise.resolve())
const deleteValue = vi.fn<(...args: string[]) => Promise<void>>(() => Promise.resolve())
vi.mock('../shared/bindings', () => ({
  SettingsService: {
    SetPluginStorageValue: (pluginID: string, key: string, jsonValue: string) => setValue(pluginID, key, jsonValue),
    DeletePluginStorageValue: (pluginID: string, key: string) => deleteValue(pluginID, key),
  },
}))

import { buildPluginStorage } from './pluginStorage'

describe('buildPluginStorage', () => {
  beforeEach(() => {
    setValue.mockClear()
    deleteValue.mockClear()
  })

  it('seeds from the snapshot literals, skipping an unreadable one', () => {
    const s = buildPluginStorage('p', { pencil: '{"color":"#da3633","size":4}', n: '3', bad: '{oops' })
    expect(s.get('pencil')).toEqual({ color: '#da3633', size: 4 })
    expect(s.get('n')).toBe(3)
    expect(s.get('bad')).toBeUndefined()
    expect(s.keys().sort()).toEqual(['n', 'pencil'])
  })

  it('set writes through as a JSON literal and is readable at once; delete removes and writes through', async () => {
    const s = buildPluginStorage('p', {})
    await s.set('k', { a: [1, 2] })
    expect(s.get('k')).toEqual({ a: [1, 2] })
    expect(setValue).toHaveBeenCalledWith('p', 'k', '{"a":[1,2]}')
    await s.delete('k')
    expect(s.get('k')).toBeUndefined()
    expect(deleteValue).toHaveBeenCalledWith('p', 'k')
  })

  it('refuses a value that cannot be stored, without touching the cache or the host', async () => {
    const s = buildPluginStorage('p', {})
    await expect(s.set('f', () => 1)).rejects.toThrow(/JSON-serialisable/)
    await expect(s.set('n', null)).rejects.toThrow(/not null/)
    expect(s.keys()).toEqual([])
    expect(setValue).not.toHaveBeenCalled()
  })

  it('getList answers [] for an absent or non-array key', async () => {
    const s = buildPluginStorage('p', { notAList: '3' })
    await expect(s.getList('missing')).resolves.toEqual([])
    await expect(s.getList('notAList')).resolves.toEqual([])
  })

  it('pushList unshifts, dedupes by the given key, and trims to max', async () => {
    const s = buildPluginStorage('p', {})
    await s.pushList('history', { url: 'a' })
    await s.pushList('history', { url: 'b' })
    await s.pushList('history', { url: 'a' }, { dedupeBy: (i) => (i as { url: string }).url, max: 5 })
    await expect(s.getList('history')).resolves.toEqual([{ url: 'a' }, { url: 'b' }])

    await s.pushList('history', { url: 'c' }, { max: 2 })
    await expect(s.getList('history')).resolves.toEqual([{ url: 'c' }, { url: 'a' }])
    expect(setValue).toHaveBeenLastCalledWith('p', 'history', JSON.stringify([{ url: 'c' }, { url: 'a' }]))
  })
})
