import views from '../locales/en/views.json'

// The Settings group registry (goal 0321): eight groups, one pane
// rendered at a time. Replaces the eleven-section single-scroll
// registry -- the converged desktop-settings shape at this size is a
// group list beside one pane, not a long page with a filter box.
// Extensions left this list in goal 0349: browsing, installing and
// updating extensions is a destination of its own, and Settings holds
// kernel configuration only. shared/viewRedirects.ts keeps the old
// `#/settings/extensions` address landing on that page.
//
// id is kebab-case and is the whole route: `#/settings/<id>`, the
// View.section deep-link value (shared/store.ts), the group list's own
// item key, and the `settings.open.<id>` command suffix. Lives in
// shared/ rather than views/ (dependency-cruiser's shared-is-a-leaf
// rule) since shared/settingsCommands.ts reads this list to build one
// command per group.
//
// titleKey is a 'views' namespace i18next key, resolved two ways:
// inside React via useTranslation(), and outside it (commands.ts
// builds its list at module scope) via resolveGroupTitle below, which
// reads the same statically-bundled English JSON directly.
export type SettingsGroupID =
  | 'general'
  | 'appearance'
  | 'security'
  | 'shortcuts'
  | 'connections'
  | 'notifications'
  | 'backups'
  | 'updates'

export interface SettingsGroup {
  id: SettingsGroupID
  titleKey: string
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  { id: 'general', titleKey: 'settings.groups.general' },
  { id: 'appearance', titleKey: 'settings.groups.appearance' },
  { id: 'security', titleKey: 'settings.groups.security' },
  { id: 'shortcuts', titleKey: 'settings.groups.shortcuts' },
  { id: 'connections', titleKey: 'settings.groups.connections' },
  { id: 'notifications', titleKey: 'settings.groups.notifications' },
  { id: 'backups', titleKey: 'settings.groups.backups' },
  { id: 'updates', titleKey: 'settings.groups.updates' },
]

export const DEFAULT_SETTINGS_GROUP: SettingsGroupID = 'general'

export function isSettingsGroup(value: string | undefined | null): value is SettingsGroupID {
  return SETTINGS_GROUPS.some((g) => g.id === value)
}

// The pre-0321 section ids that palette history, in-app deep links and
// bookmarks may still carry, mapped onto the group that absorbed them.
// Keeping the map here (rather than dropping the old ids) means an
// "Open Settings -> MCP access" link saved before this change still
// lands somewhere honest instead of on General.
const ABSORBED_SECTIONS: Record<string, SettingsGroupID> = {
  'keyboard-shortcuts': 'shortcuts',
  'global-hotkey': 'shortcuts',
  'mcp-access': 'connections',
  'remote-access': 'connections',
  contract: 'connections',
}

// resolveSettingsGroup maps any incoming section/route value onto a
// real group, falling back to General.
export function resolveSettingsGroup(value: string | undefined | null): SettingsGroupID {
  if (isSettingsGroup(value)) return value
  if (value && ABSORBED_SECTIONS[value]) return ABSORBED_SECTIONS[value]
  return DEFAULT_SETTINGS_GROUP
}

// Dotted-path lookup into the raw 'views' namespace JSON --
// deliberately bypassing i18next (a module-scope array like
// commands.ts's COMMANDS has no React tree to call useTranslation()
// from, and shared/ can't import app/i18n.ts, the only place the
// i18next singleton is initialized).
export function resolveGroupTitle(group: SettingsGroup): string {
  let node: unknown = views
  for (const part of group.titleKey.split('.')) {
    if (typeof node !== 'object' || node === null) return group.id
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : group.id
}
