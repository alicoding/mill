import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionSettingDecl } from '../atlas/atlasNounRegistry'
import { extensionSetting, resolveExtensionSetting, subscribeExtensionSetting, useExtensionSettingsStore } from './extensionSettingsStore'

describe('extensionSetting', () => {
  beforeEach(() => {
    useExtensionSettingsStore.getState().setValues({})
  })

  it('answers the declared default when nothing is stored', () => {
    expect(extensionSetting('note', 'richCodeBlocks', false)).toBe(false)
    expect(extensionSetting('note', 'richCodeBlocks', true)).toBe(true)
  })

  it('a stored value wins over the default, including stored-false over default-true', () => {
    useExtensionSettingsStore.getState().setValues({ note: { richCodeBlocks: false } })
    expect(extensionSetting('note', 'richCodeBlocks', true)).toBe(false)
    useExtensionSettingsStore.getState().setValues({ note: { richCodeBlocks: true } })
    expect(extensionSetting('note', 'richCodeBlocks', false)).toBe(true)
  })

  it('another extension or key never bleeds through', () => {
    useExtensionSettingsStore.getState().setValues({ diagram: { richCodeBlocks: true }, note: { other: true } })
    expect(extensionSetting('note', 'richCodeBlocks', false)).toBe(false)
  })

  it('serves every scalar type, and fails closed to the default on a type mismatch', () => {
    useExtensionSettingsStore.getState().setValues({ sheet: { previewRows: 25, label: 'x' }, bm: { titleStyle: 'address' } })
    expect(extensionSetting('sheet', 'previewRows', 50)).toBe(25)
    expect(extensionSetting('bm', 'titleStyle', 'hostname')).toBe('address')
    // A stale blob holding a string where a number is declared never
    // reaches a consumer expecting a number.
    expect(extensionSetting('sheet', 'label', 50)).toBe(50)
    expect(extensionSetting('sheet', 'previewRows', 'text')).toBe('text')
  })
})

describe('resolveExtensionSetting', () => {
  const enumDecl: ExtensionSettingDecl = {
    type: 'enum', key: 'titleStyle', label: 'Title', description: '', defaultValue: 'hostname',
    options: [{ value: 'hostname', label: 'Site name' }, { value: 'address', label: 'Full address' }],
  }
  const numberDecl: ExtensionSettingDecl = { type: 'number', key: 'rows', label: 'Rows', description: '', defaultValue: 50 }

  beforeEach(() => {
    useExtensionSettingsStore.getState().setValues({})
  })

  it('an enum value no longer among the options resolves to the default', () => {
    useExtensionSettingsStore.getState().setValues({ bm: { titleStyle: 'retired-option' } })
    expect(resolveExtensionSetting('bm', enumDecl)).toBe('hostname')
    useExtensionSettingsStore.getState().setValues({ bm: { titleStyle: 'address' } })
    expect(resolveExtensionSetting('bm', enumDecl)).toBe('address')
  })

  it('a non-finite number resolves to the default', () => {
    useExtensionSettingsStore.getState().setValues({ sheet: { rows: Number.NaN } })
    expect(resolveExtensionSetting('sheet', numberDecl)).toBe(50)
  })

  it('subscribeExtensionSetting fires only when THIS key resolves differently, and stops after unsubscribe', () => {
    const fn = vi.fn()
    const off = subscribeExtensionSetting('sheet', numberDecl, fn)
    useExtensionSettingsStore.getState().setValues({ sheet: { other: 1 } })
    expect(fn).not.toHaveBeenCalled()
    useExtensionSettingsStore.getState().setValues({ sheet: { rows: 10 } })
    expect(fn).toHaveBeenCalledWith(10)
    // An invalid write resolves to the default -- a change from 10.
    useExtensionSettingsStore.getState().setValues({ sheet: { rows: 'bad' } })
    expect(fn).toHaveBeenLastCalledWith(50)
    off()
    useExtensionSettingsStore.getState().setValues({ sheet: { rows: 7 } })
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
