import { describe, expect, it, vi } from 'vitest'

const setValue = vi.fn<(...args: string[]) => Promise<void>>(() => Promise.resolve())
const deleteValue = vi.fn<(...args: string[]) => Promise<void>>(() => Promise.resolve())
vi.mock('../shared/bindings', () => ({
  SettingsService: {
    SetPluginStorageValue: (pluginID: string, key: string, jsonValue: string) => setValue(pluginID, key, jsonValue),
    DeletePluginStorageValue: (pluginID: string, key: string) => deleteValue(pluginID, key),
  },
}))

import { settingsPluginStorageDoors } from './pluginStorageHostDoors'

describe('settingsPluginStorageDoors', () => {
  it('set forwards the literal (not the decoded value) to SettingsService, keyed by pluginId', async () => {
    const doors = settingsPluginStorageDoors('p')
    await doors.set('k', { a: 1 }, '{"a":1}')
    expect(setValue).toHaveBeenCalledWith('p', 'k', '{"a":1}')
  })

  it('delete forwards to SettingsService, keyed by pluginId', async () => {
    const doors = settingsPluginStorageDoors('p')
    await doors.delete('k')
    expect(deleteValue).toHaveBeenCalledWith('p', 'k')
  })
})
