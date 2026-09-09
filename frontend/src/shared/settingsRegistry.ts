import type { SettingsGroupID } from './settingsGroups'

// The settings registry (goal 0412 S1): every individual setting a
// Settings pane renders, as one typed table -- the ground goal
// 0412 S2's search and the palette's per-setting reach both index. A
// setting exists only through the registry; a pane may render a row
// only for an entry that lives here, never a hand-rolled label/caption
// pair of its own.
//
// id is `<group>.<camelCase>`, stable (it is the palette
// `settings.show.<id>` command suffix and a highlight target once S2
// lands) -- renaming one is a breaking change, same as
// shared/settingsGroups.ts's own group ids.
export interface SettingEntry {
  id: string
  group: SettingsGroupID
  labelKey: string
  captionKey?: string
  keywords: string[]
  docsPage?: string
}

export const SETTINGS: readonly SettingEntry[] = [
  {
    id: 'general.launchAtLogin',
    group: 'general',
    labelKey: 'settings.general.launchAtLoginLabel',
    captionKey: 'settings.general.launchAtLoginCaption',
    keywords: ['launch at login', 'startup', 'autostart', 'login items'],
  },
  {
    id: 'general.saveMode',
    group: 'general',
    labelKey: 'settings.general.saveModeLabel',
    keywords: ['save mode', 'autosave', 'auto save', 'explicit save'],
  },
  {
    id: 'general.canvasNavigation',
    group: 'general',
    labelKey: 'settings.general.canvasNavigationLabel',
    keywords: ['canvas navigation', 'trackpad', 'mouse', 'pan and zoom'],
  },
  {
    id: 'appearance.colorMode',
    group: 'appearance',
    labelKey: 'settings.appearance.themeLabel',
    captionKey: 'settings.appearance.themeCaption',
    keywords: ['theme mode', 'single theme', 'follow system', 'light mode', 'dark mode', 'system appearance'],
  },
  {
    id: 'appearance.theme',
    group: 'appearance',
    labelKey: 'settings.theme.label',
    captionKey: 'settings.theme.caption',
    keywords: ['theme', 'color scheme', 'appearance'],
  },
  {
    id: 'appearance.lightTheme',
    group: 'appearance',
    labelKey: 'settings.theme.lightLabel',
    captionKey: 'settings.theme.lightCaption',
    keywords: ['light theme', 'light mode', 'color scheme'],
  },
  {
    id: 'appearance.darkTheme',
    group: 'appearance',
    labelKey: 'settings.theme.darkLabel',
    captionKey: 'settings.theme.darkCaption',
    keywords: ['dark theme', 'dark mode', 'color scheme'],
  },
  {
    id: 'appearance.density',
    group: 'appearance',
    labelKey: 'settings.appearance.densityLabel',
    keywords: ['density', 'compact', 'comfortable spacing'],
  },
  {
    id: 'security.extensionManagedBy',
    group: 'security',
    labelKey: 'extensions.policy.managedByLabel',
    keywords: ['managed by', 'device management', 'organisation policy'],
  },
  {
    id: 'security.extensionRequiredTier',
    group: 'security',
    labelKey: 'extensions.policy.requiredTierLabel',
    keywords: ['trust tier', 'extension trust', 'required tier'],
  },
  {
    id: 'security.extensionBlockedCapabilities',
    group: 'security',
    labelKey: 'extensions.policy.blockedCapabilitiesLabel',
    keywords: ['blocked capabilities', 'extension permissions'],
  },
  {
    id: 'security.extensionAllowedSources',
    group: 'security',
    labelKey: 'extensions.policy.allowedSourcesLabel',
    keywords: ['allowed sources', 'extension install sources'],
  },
  {
    id: 'security.extensionLists',
    group: 'security',
    labelKey: 'extensions.policy.listsLabel',
    keywords: ['allow list', 'block list', 'extension policy'],
  },
  {
    id: 'security.extensionPolicyFile',
    group: 'security',
    labelKey: 'extensions.policy.fileLabel',
    captionKey: 'extensions.policy.fileCaption',
    keywords: ['policy file', 'managed policy'],
    docsPage: 'reference/managed-extensions.md',
  },
  {
    id: 'shortcuts.globalHotkey',
    group: 'shortcuts',
    labelKey: 'settings.globalHotkey.label',
    captionKey: 'settings.globalHotkey.description',
    keywords: ['hotkey', 'keybinding', 'shortcut', 'global shortcut', 'quick panel'],
    docsPage: 'reference/commands.md',
  },
  {
    id: 'connections.mcpAddress',
    group: 'connections',
    labelKey: 'settings.mcp.addressLabel',
    keywords: ['mcp address', 'mcp server', 'agent connection'],
    docsPage: 'agents/connect-mcp.md',
  },
  {
    id: 'connections.mcpAllowImport',
    group: 'connections',
    labelKey: 'settings.mcp.allowImportLabel',
    captionKey: 'settings.mcp.allowImportCaption',
    keywords: ['mcp import', 'agent write access', 'allow agent changes'],
    docsPage: 'agents/connect-mcp.md',
  },
  {
    id: 'connections.mcpAskBeforeImport',
    group: 'connections',
    labelKey: 'settings.mcp.askBeforeImportLabel',
    captionKey: 'settings.mcp.askBeforeImportCaption',
    keywords: ['mcp approval', 'ask before import', 'agent approval'],
    docsPage: 'agents/connect-mcp.md',
  },
  {
    id: 'notifications.awayAfter',
    group: 'notifications',
    labelKey: 'settings.notifications.awayAfterLabel',
    captionKey: 'settings.notifications.awayAfterCaption',
    keywords: ['away after', 'idle timeout', 'presence'],
    docsPage: 'reference/settings.md',
  },
  {
    id: 'notifications.alertPermission',
    group: 'notifications',
    labelKey: 'settings.notifications.alertPermissionLabel',
    captionKey: 'settings.notifications.alertPermissionNote',
    keywords: ['alerts', 'notification permission', 'stay on screen'],
    docsPage: 'reference/settings.md',
  },
] as const

export function settingById(id: string): SettingEntry | undefined {
  return SETTINGS.find((s) => s.id === id)
}

// A pane call site names its own row's id once, here -- a typo'd or
// renamed id fails at first render rather than silently dropping the
// row's label, since SettingsRow requires a real SettingEntry, not an
// id it re-resolves.
export function mustSetting(id: string): SettingEntry {
  const entry = settingById(id)
  if (!entry) throw new Error(`settingsRegistry: no entry for id "${id}"`)
  return entry
}
