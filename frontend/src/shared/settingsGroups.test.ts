import { describe, expect, it } from 'vitest'
import { SETTINGS_GROUPS, DEFAULT_SETTINGS_GROUP, isSettingsGroup, resolveGroupTitle, resolveSettingsGroup } from './settingsGroups'
import { groupFromHash, hashForGroup, isSettingsHash } from '../views/settingsRoute'

// The Settings group registry and its route (goal 0321). Pinned as
// DATA, not just types: the ORDER is the reading order of the group
// list, and the ids are a public surface -- they are the route, the
// deep-link value and the `settings.open.<id>` command suffix, so a
// rename is a breaking change a test should force someone to make on
// purpose.
describe('SETTINGS_GROUPS', () => {
  it('is the seven groups, in reading order', () => {
    expect(SETTINGS_GROUPS.map((g) => g.id)).toEqual([
      'general', 'appearance', 'shortcuts',
      'connections', 'notifications', 'backups', 'updates',
    ])
  })

  it('resolves every title from the shipped copy, never falling back to the id', () => {
    expect(SETTINGS_GROUPS.map(resolveGroupTitle)).toEqual([
      'General', 'Appearance', 'Shortcuts',
      'Connections', 'Notifications', 'Backups', 'Updates',
    ])
  })

  it('defaults to General and recognizes only real ids', () => {
    expect(DEFAULT_SETTINGS_GROUP).toBe('general')
    expect(isSettingsGroup('shortcuts')).toBe(true)
    // Extensions is a destination of its own now (goal 0349), so its
    // old id is not a group -- shared/viewRedirects.ts sends the old
    // address to the real page rather than to General.
    expect(isSettingsGroup('extensions')).toBe(false)
    expect(isSettingsGroup('nonsense')).toBe(false)
    expect(isSettingsGroup(undefined)).toBe(false)
  })

  it('lands a pre-0321 section id on the group that absorbed it', () => {
    expect(resolveSettingsGroup('keyboard-shortcuts')).toBe('shortcuts')
    expect(resolveSettingsGroup('global-hotkey')).toBe('shortcuts')
    expect(resolveSettingsGroup('mcp-access')).toBe('connections')
    expect(resolveSettingsGroup('remote-access')).toBe('connections')
    expect(resolveSettingsGroup('contract')).toBe('connections')
    expect(resolveSettingsGroup('nonsense')).toBe('general')
  })
})

describe('the #/settings route', () => {
  it('decodes a group, treats a bare #/settings as General, and ignores every other hash', () => {
    expect(groupFromHash('#/settings/appearance')).toBe('appearance')
    expect(groupFromHash('#/settings')).toBe('general')
    expect(groupFromHash('#/settings/mcp-access')).toBe('connections')
    expect(groupFromHash('#/settings/nonsense')).toBe('general')
    expect(groupFromHash('#/quickpanel')).toBeNull()
    expect(groupFromHash('')).toBeNull()
    expect(isSettingsHash('#/traypanel')).toBe(false)
  })

  it('round-trips every group through its own hash', () => {
    for (const group of SETTINGS_GROUPS) {
      expect(groupFromHash(hashForGroup(group.id))).toBe(group.id)
    }
  })
})
