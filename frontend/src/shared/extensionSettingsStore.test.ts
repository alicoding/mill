import { beforeEach, describe, expect, it } from 'vitest'
import { extensionSetting, useExtensionSettingsStore } from './extensionSettingsStore'

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
})
