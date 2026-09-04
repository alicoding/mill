import { DEFAULT_SETTINGS_GROUP, resolveSettingsGroup, type SettingsGroupID } from '../shared/settingsGroups'

// The Settings route (goal 0321): `#/settings/<group>`, with
// `#/settings` meaning General. The main window's other destinations
// are store views, not hash routes -- Settings gets one because a
// group pane is a place a user lands on and comes back to, and the
// hash is the only address this webview has (production asset serving
// has no SPA fallback, main.tsx's own note). The aux-window routes
// main.tsx branches on before mount (#/quickpanel, #/traypanel, ...)
// are unaffected: none of them starts with #/settings.
const SETTINGS_HASH_PREFIX = '#/settings'

// Remembered per device (localStorage, not the settings service): which
// pane you were last reading is this machine's own convenience, the
// same per-device split Appearance's theme choice already follows.
const LAST_GROUP_STORAGE_KEY = 'mill-settings-group'

// groupFromHash decodes a raw hash string. Pure, so the mapping is
// unit-testable without a DOM. null means "this hash is not a Settings
// route at all" -- distinct from '#/settings', which IS one and means
// General.
export function groupFromHash(hash: string): SettingsGroupID | null {
  if (hash !== SETTINGS_HASH_PREFIX && !hash.startsWith(`${SETTINGS_HASH_PREFIX}/`)) return null
  const rest = hash.slice(SETTINGS_HASH_PREFIX.length).replace(/^\//, '')
  return rest === '' ? DEFAULT_SETTINGS_GROUP : resolveSettingsGroup(rest)
}

export function hashForGroup(group: SettingsGroupID): string {
  return `${SETTINGS_HASH_PREFIX}/${group}`
}

export function isSettingsHash(hash: string): boolean {
  return groupFromHash(hash) !== null
}

export function readLastSettingsGroup(): SettingsGroupID {
  try {
    return resolveSettingsGroup(localStorage.getItem(LAST_GROUP_STORAGE_KEY))
  } catch {
    return DEFAULT_SETTINGS_GROUP
  }
}

export function rememberSettingsGroup(group: SettingsGroupID): void {
  try {
    localStorage.setItem(LAST_GROUP_STORAGE_KEY, group)
  } catch {
    // Per-device convenience only -- a browser refusing storage just
    // means the next visit starts on the remembered-nothing default.
  }
}

// writeSettingsHash / clearSettingsHash keep the address bar in step
// with the pane without adding history entries: replaceState, so the
// back gesture still leaves Settings rather than walking its panes.
export function writeSettingsHash(group: SettingsGroupID): void {
  const next = hashForGroup(group)
  if (window.location.hash === next) return
  history.replaceState(null, '', window.location.pathname + window.location.search + next)
}

export function clearSettingsHash(): void {
  if (!isSettingsHash(window.location.hash)) return
  history.replaceState(null, '', window.location.pathname + window.location.search)
}
