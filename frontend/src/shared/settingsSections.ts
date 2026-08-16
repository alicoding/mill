import views from '../locales/en/views.json'

// Settings section registry (goal 0077): the single ordered list every
// consumer renders from -- SettingsView (the page itself + its TOC/
// filter), and shared/commands.ts (one palette-only "Open Settings ->
// <Title>" command per section). Lives in shared/ rather than views/
// (dependency-cruiser's shared-is-a-leaf rule, .claude/rules/frontend.md)
// since commands.ts is itself a shared/ leaf and needs to read this list.
//
// id is kebab-case and doubles as the section's DOM anchor
// (`settings-${id}`) and its View.section deep-link value (store.ts).
// titleKey is a 'views' namespace i18next key, resolved two ways: inside
// SettingsView via the normal useTranslation() hook, and outside React
// (commands.ts builds its command list at module scope) via
// resolveSectionTitle below, which reads the same statically-bundled
// English JSON directly -- matching every other Command.label in
// commands.ts, which is plain English text, never translated at
// call time (there is only one shipped locale; see app/i18n.ts).
export interface SettingsSection {
  id: string
  titleKey: string
  keywords: string[]
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'appearance', titleKey: 'settings.sections.appearance', keywords: ['theme', 'dark', 'light', 'color', 'appearance'] },
  { id: 'general', titleKey: 'settings.sections.general', keywords: ['launch', 'login', 'startup', 'general'] },
  { id: 'keyboard-shortcuts', titleKey: 'settings.sections.keyboardShortcuts', keywords: ['keyboard', 'shortcut', 'hotkey', 'keymap', 'rebind', 'command'] },
  { id: 'global-hotkey', titleKey: 'settings.sections.globalHotkey', keywords: ['hotkey', 'summon', 'quick panel', 'global'] },
  { id: 'mcp-access', titleKey: 'settings.sections.mcpAccess', keywords: ['mcp', 'import', 'approval', 'access', 'client'] },
  { id: 'contract', titleKey: 'settings.sections.contract', keywords: ['contract', 'export', 'schema', 'catalog', 'agent'] },
  { id: 'notifications', titleKey: 'settings.sections.notifications', keywords: ['notification', 'away', 'idle', 'alert', 'approval'] },
  { id: 'backups', titleKey: 'settings.sections.dataStewardship', keywords: ['backup', 'export', 'import', 'snapshot', 'restore'] },
  { id: 'updates', titleKey: 'settings.sections.updates', keywords: ['update', 'version', 'check', 'upgrade'] },
]

// Dotted-path lookup into the raw 'views' namespace JSON -- deliberately
// bypassing i18next (a module-scope array like commands.ts's COMMANDS
// has no React tree to call useTranslation() from, and shared/ can't
// import app/i18n.ts, the only place the i18next singleton is
// initialized). Every titleKey above is a real path into
// locales/en/views.json, so this always resolves to a string; the
// fallback only guards a typo'd key from crashing command generation.
export function resolveSectionTitle(section: SettingsSection): string {
  let node: unknown = views
  for (const part of section.titleKey.split('.')) {
    if (typeof node !== 'object' || node === null) return section.id
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : section.id
}

// Registry-based, deterministic filter match (design contract item 3):
// case-insensitive substring against the resolved title + keywords,
// never DOM scraping. Shared by SettingsView's own filter box.
export function sectionMatchesQuery(section: SettingsSection, title: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  if (title.toLowerCase().includes(q)) return true
  return section.keywords.some((k) => k.includes(q))
}
