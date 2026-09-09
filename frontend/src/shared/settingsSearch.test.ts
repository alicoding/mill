import { describe, expect, it } from 'vitest'
import views from '../locales/en/views.json'
import { SETTINGS } from './settingsRegistry'
import { SETTINGS_GROUPS, resolveViewsKey } from './settingsGroups'
import { buildSettingsSearchEntries, rankSettings, type SettingsSearchEntry } from './settingsSearch'

// Ranking over the registry (goal 0412 S2): buildSettingsSearchEntries
// resolved the same raw-JSON way settingsRegistry.test.ts's own
// `resolvesInViews` reads real shipped copy -- no react-i18next mock
// needed, mirroring settingsGroups.test.ts's own module-scope
// resolution style.
function labelFor(key: string): string {
  return resolveViewsKey(key) ?? key
}
function groupTitleFor(id: string): string {
  const group = SETTINGS_GROUPS.find((g) => g.id === id)
  return group ? (resolveViewsKey(group.titleKey) ?? group.id) : id
}

const ENTRIES = buildSettingsSearchEntries(labelFor, groupTitleFor)

describe('buildSettingsSearchEntries', () => {
  it('indexes every registry setting, one entry each', () => {
    expect(ENTRIES).toHaveLength(SETTINGS.length)
  })

  it('resolves a real label, caption and group breadcrumb from shipped copy', () => {
    const hotkey = ENTRIES.find((e) => e.entry.id === 'shortcuts.globalHotkey')
    expect(hotkey?.label).toBe(views.settings.globalHotkey.label)
    expect(hotkey?.caption).toBe(views.settings.globalHotkey.description)
    expect(hotkey?.groupTitle).toBe('Shortcuts')
  })

  it('folds label, caption and keywords into one lowercase searchText', () => {
    const hotkey = ENTRIES.find((e) => e.entry.id === 'shortcuts.globalHotkey')!
    expect(hotkey.searchText).toContain('global hotkey')
    expect(hotkey.searchText).toContain('keybinding')
  })
})

describe('rankSettings', () => {
  it('returns nothing for an empty or whitespace-only query', () => {
    expect(rankSettings(ENTRIES, '')).toEqual([])
    expect(rankSettings(ENTRIES, '   ')).toEqual([])
  })

  it('a keyword hit ranks: "hotkey" finds the global hotkey setting via its keyword, not just its label', () => {
    const result = rankSettings(ENTRIES, 'hotkey')
    expect(result.map((r) => r.entry.id)).toContain('shortcuts.globalHotkey')
    expect(result[0].entry.id).toBe('shortcuts.globalHotkey')
  })

  it('every keyword-prefix hit ranks ahead of a plain fuzzy hit, real registry order preserved within the tier', () => {
    // "auto" is a keyword prefix for BOTH launchAtLogin ("autostart")
    // and saveMode ("autosave"/"auto save") -- both land in the
    // prefix tier, in the registry's own array order.
    const result = rankSettings(ENTRIES, 'auto')
    const ids = result.map((r) => r.entry.id)
    expect(ids).toContain('general.launchAtLogin')
    expect(ids).toContain('general.saveMode')
    expect(ids.indexOf('general.launchAtLogin')).toBeLessThan(ids.indexOf('general.saveMode'))
  })

  it('caps at 12 results', () => {
    const many: SettingsSearchEntry[] = Array.from({ length: 20 }, (_, i) => ({
      entry: SETTINGS[0],
      label: `Widget ${i}`,
      groupTitle: 'General',
      searchText: `widget ${i}`,
    }))
    expect(rankSettings(many, 'widget')).toHaveLength(12)
  })

  it('a query matching nothing returns no results', () => {
    expect(rankSettings(ENTRIES, 'zzzzznonsense')).toEqual([])
  })
})
