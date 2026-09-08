import { describe, expect, it } from 'vitest'
import views from '../locales/en/views.json'
import { SETTINGS, settingById, mustSetting } from './settingsRegistry'
import { SETTINGS_GROUPS } from './settingsGroups'

// The settings registry (goal 0412 S1) -- pinned as DATA, not just
// types: every entry's id is a public surface (a future
// `settings.show.<id>` palette command, S2's highlight target), so a
// rename is a breaking change a test should force someone to make on
// purpose.

function resolvesInViews(key: string): boolean {
  let node: unknown = views
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return false
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string'
}

const GROUP_IDS = new Set(SETTINGS_GROUPS.map((g) => g.id))

describe('SETTINGS', () => {
  it('has at least one entry', () => {
    expect(SETTINGS.length).toBeGreaterThan(0)
  })

  it('has unique ids', () => {
    const ids = SETTINGS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('ids are <group>.<camelCase>, the group prefix matching the entry\'s own group', () => {
    for (const setting of SETTINGS) {
      expect(setting.id.startsWith(`${setting.group}.`), `${setting.id} starts with its group "${setting.group}."`).toBe(true)
      const rest = setting.id.slice(setting.group.length + 1)
      expect(rest, `${setting.id}'s suffix is camelCase`).toMatch(/^[a-z][a-zA-Z0-9]*$/)
    }
  })

  it('every entry belongs to a real settings group', () => {
    for (const setting of SETTINGS) {
      expect(GROUP_IDS.has(setting.group), `${setting.id} names a real group`).toBe(true)
    }
  })

  it('every labelKey resolves to a real English string', () => {
    for (const setting of SETTINGS) {
      expect(resolvesInViews(setting.labelKey), `${setting.id}'s labelKey "${setting.labelKey}" resolves in views.json`).toBe(true)
    }
  })

  it('every captionKey resolves to a real English string', () => {
    for (const setting of SETTINGS) {
      if (!setting.captionKey) continue
      expect(resolvesInViews(setting.captionKey), `${setting.id}'s captionKey "${setting.captionKey}" resolves in views.json`).toBe(true)
    }
  })

  it('carries at least two keywords per entry', () => {
    for (const setting of SETTINGS) {
      expect(setting.keywords.length, `${setting.id} has at least two keywords`).toBeGreaterThanOrEqual(2)
    }
  })

  it('settingById finds a real entry and misses a fake one', () => {
    expect(settingById('general.launchAtLogin')?.labelKey).toBe('settings.general.launchAtLoginLabel')
    expect(settingById('nonsense.setting')).toBeUndefined()
  })

  it('mustSetting throws for an id with no entry', () => {
    expect(() => mustSetting('nonsense.setting')).toThrow(/no entry for id/)
    expect(mustSetting('shortcuts.globalHotkey').id).toBe('shortcuts.globalHotkey')
  })
})
