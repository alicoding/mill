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
})
