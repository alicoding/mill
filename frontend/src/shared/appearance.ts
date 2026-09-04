// The one appearance model every Mill window reads: color mode, a
// color scheme per mode, and display density. It lives in shared/ --
// a leaf every layer may reach, which is what lets a Settings page and
// the app shell hold the same choice without either importing the
// other.
//
// Scheme ids ARE Primer's own data-light-theme/data-dark-theme attribute
// values -- no translation layer, so a scheme id can never drift from
// the stylesheet that paints it. main.tsx imports one
// @primer/primitives functional theme file per id below.

import type { DisplayDensity } from './density'
import { isKnownScheme } from './appearanceThemes'

// The persisted keys. COLOR_MODE_STORAGE_KEY has always been the color
// mode's door; the two scheme keys sit beside it.
export const COLOR_MODE_STORAGE_KEY = 'mill-color-mode'

export type ColorMode = 'light' | 'dark' | 'auto'
export type ResolvedMode = 'light' | 'dark'

// The six light schemes and seven dark schemes Settings offers, in the
// order they are listed there. dark_dimmed_high_contrast is deliberately
// NOT offered on its own: it exists only as Dimmed's high-contrast pair,
// reached through the system contrast preference below.
export const LIGHT_SCHEMES = [
  'light',
  'light_high_contrast',
  'light_colorblind',
  'light_colorblind_high_contrast',
  'light_tritanopia',
  'light_tritanopia_high_contrast',
] as const

export const DARK_SCHEMES = [
  'dark',
  'dark_dimmed',
  'dark_high_contrast',
  'dark_colorblind',
  'dark_colorblind_high_contrast',
  'dark_tritanopia',
  'dark_tritanopia_high_contrast',
] as const

export type LightScheme = (typeof LIGHT_SCHEMES)[number]
export type DarkScheme = (typeof DARK_SCHEMES)[number]

export const LIGHT_SCHEME_STORAGE_KEY = 'mill-light-scheme'
export const DARK_SCHEME_STORAGE_KEY = 'mill-dark-scheme'

// The two scheme fields are plain strings, not the built-in unions: a
// plugin may contribute a theme, and its scheme id ("<pluginId>.<id>",
// shared/appearanceThemes.ts) is as valid a choice as Primer's own
// (goal 0342). resolveSchemes is where an id with no stylesheet behind
// it falls back.
export interface Appearance {
  mode: ColorMode
  lightScheme: string
  darkScheme: string
}

// Every scheme's high-contrast counterpart, used only when the OS
// reports prefers-contrast: more while the mode is Match system. A
// scheme that already IS high contrast maps to itself.
const HIGH_CONTRAST_PAIR: Record<string, string> = {
  light: 'light_high_contrast',
  light_colorblind: 'light_colorblind_high_contrast',
  light_tritanopia: 'light_tritanopia_high_contrast',
  dark: 'dark_high_contrast',
  dark_dimmed: 'dark_dimmed_high_contrast',
  dark_colorblind: 'dark_colorblind_high_contrast',
  dark_tritanopia: 'dark_tritanopia_high_contrast',
}

// highContrastPair returns the scheme to paint when the OS asks for
// more contrast. Unknown or already-high-contrast schemes pass through
// unchanged, so this is safe to apply unconditionally.
export function highContrastPair(scheme: string): string {
  return HIGH_CONTRAST_PAIR[scheme] ?? scheme
}

// resolveSchemes turns a stored choice plus the live system contrast
// preference into the two attribute values Primer's stylesheets are
// scoped to. The contrast upgrade applies under Match system only: an
// explicit Light/Dark pick is the user naming the exact scheme, and
// silently repainting it would make their choice a lie.
export function resolveSchemes(
  a: Appearance,
  prefersMoreContrast: boolean,
  contributed?: readonly string[],
): { lightTheme: string; darkTheme: string } {
  const upgrade = a.mode === 'auto' && prefersMoreContrast
  const light = knownOr(a.lightScheme, LIGHT_SCHEMES, 'light', contributed)
  const dark = knownOr(a.darkScheme, DARK_SCHEMES, 'dark', contributed)
  return {
    lightTheme: upgrade ? highContrastPair(light) : light,
    darkTheme: upgrade ? highContrastPair(dark) : dark,
  }
}

// knownOr sends a family back to its built-in default when the stored
// choice has no stylesheet behind it any more, which is what happens
// the moment the plugin that contributed a theme is turned off or
// removed. The stored value is left alone: turning the plugin back on
// restores the choice.
function knownOr(scheme: string, builtIn: readonly string[], fallback: string, contributed?: readonly string[]): string {
  const known = contributed ? builtIn.includes(scheme) || contributed.includes(scheme) : isKnownScheme(scheme, builtIn)
  return known ? scheme : fallback
}

// normalizeMode collapses Primer's four-value color mode vocabulary
// ('day'/'night' alongside 'light'/'dark') into the two values Mill's
// own attributes and the plugin theme contract expose.
export function normalizeMode(mode: string | null | undefined): ResolvedMode {
  return mode === 'dark' || mode === 'night' ? 'dark' : 'light'
}

function isLightScheme(v: unknown): v is LightScheme {
  return typeof v === 'string' && (LIGHT_SCHEMES as readonly string[]).includes(v)
}

function isDarkScheme(v: unknown): v is DarkScheme {
  return typeof v === 'string' && (DARK_SCHEMES as readonly string[]).includes(v)
}

// A contributed scheme id is "<pluginId>.<themeId>", the one shape a
// built-in id never takes. Storage keeps it even while its plugin is
// off, so the choice survives a reload.
function isPluginSchemeID(v: unknown): v is string {
  return typeof v === 'string' && /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/.test(v)
}

// readAppearance reads the persisted choice. Storage is the same door
// the color mode has always used (theme.ts's keys), read once
// synchronously wherever a window needs its first-paint value; an
// unrecognized stored value falls back to the default rather than
// wedging a window into a scheme no stylesheet paints.
export function readAppearance(): Appearance {
  const raw = (key: string) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }
  const mode = raw(COLOR_MODE_STORAGE_KEY)
  const light = raw(LIGHT_SCHEME_STORAGE_KEY)
  const dark = raw(DARK_SCHEME_STORAGE_KEY)
  return {
    mode: mode === 'light' || mode === 'dark' ? mode : 'auto',
    lightScheme: isLightScheme(light) || isPluginSchemeID(light) ? light : 'light',
    darkScheme: isDarkScheme(dark) || isPluginSchemeID(dark) ? dark : 'dark',
  }
}

export function writeAppearance(a: Appearance): void {
  try {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, a.mode)
    localStorage.setItem(LIGHT_SCHEME_STORAGE_KEY, a.lightScheme)
    localStorage.setItem(DARK_SCHEME_STORAGE_KEY, a.darkScheme)
  } catch {
    // A window with storage denied still renders; it just forgets.
  }
}

// The cross-window channel (goal 0320 S2). Mill's windows are separate
// documents of one origin -- auxiliary Wails windows and, in server
// mode, other browser tabs -- so the change travels the two web
// platform mechanisms built for exactly that: BroadcastChannel, and the
// storage event every same-origin document already receives when
// writeAppearance runs. Both are subscribed; a duplicate delivery is
// idempotent (the receiver re-reads storage and applies).
const CHANNEL_NAME = 'mill-appearance'

export interface AppearanceMessage extends Appearance {
  density: DisplayDensity
}

export function publishAppearance(msg: AppearanceMessage): void {
  try {
    new BroadcastChannel(CHANNEL_NAME).postMessage(msg)
  } catch {
    // BroadcastChannel unavailable: the storage event still carries the
    // mode and schemes; only density needs the channel.
  }
}

// The store every window's provider reads. Module-level, not React
// state, because the change can arrive from three places: this
// document's own Settings view, another Mill window, and another
// browser tab of a server-mode instance. Neither BroadcastChannel nor
// the storage event notifies the document that made the change, so the
// local listener set is what closes that loop.
let current: Appearance | null = null
const listeners = new Set<() => void>()
let unbind: (() => void) | null = null

export function getAppearance(): Appearance {
  if (current === null) current = readAppearance()
  return current
}

// setAppearance is the one write door: persist, tell the other
// documents, then wake this one's own subscribers.
export function setAppearance(next: Appearance, density?: DisplayDensity): void {
  current = next
  writeAppearance(next)
  publishAppearance({ ...next, density: density ?? currentDensity() })
  for (const l of listeners) l()
}

function currentDensity(): DisplayDensity {
  return document.documentElement.dataset.density === 'compact' ? 'compact' : 'comfortable'
}

// onRemoteAppearance runs for a change made in another document, with
// the density that came with it (the storage event carries no density,
// so that arrives only over the channel).
let remoteDensity: ((d: DisplayDensity) => void) | null = null
export function setRemoteDensityHandler(fn: ((d: DisplayDensity) => void) | null): void {
  remoteDensity = fn
}

export function subscribeAppearance(onChange: () => void): () => void {
  listeners.add(onChange)
  if (unbind === null) unbind = bindRemote()
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0) {
      unbind?.()
      unbind = null
    }
  }
}

function bindRemote(): () => void {
  const accept = (msg: AppearanceMessage | null) => {
    current = msg ? { mode: msg.mode, lightScheme: msg.lightScheme, darkScheme: msg.darkScheme } : readAppearance()
    if (msg?.density && remoteDensity) remoteDensity(msg.density)
    for (const l of listeners) l()
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === COLOR_MODE_STORAGE_KEY || e.key === LIGHT_SCHEME_STORAGE_KEY || e.key === DARK_SCHEME_STORAGE_KEY) accept(null)
  }
  window.addEventListener('storage', onStorage)
  let channel: BroadcastChannel | null = null
  try {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (e: MessageEvent) => accept(e.data as AppearanceMessage)
  } catch {
    channel = null
  }
  return () => {
    window.removeEventListener('storage', onStorage)
    channel?.close()
  }
}

// applyAppearance writes the theme attributes onto a document root.
// Primer's own three attributes are mirrored here so the handful of
// truly global rules in index.css can read real theme tokens (App.tsx
// carried this for the main window alone before goal 0320; every window
// needs it). data-mill-theme/data-mill-scheme are Mill's own resolved
// pair -- the plugin theme contract (userdocs/reference/plugin-theming.md)
// and any rule that needs the settled answer rather than the three
// attributes it has to combine itself.
export function applyAppearance(
  root: HTMLElement,
  v: { mode: ColorMode; lightTheme: string; darkTheme: string; resolvedMode: ResolvedMode },
): void {
  root.dataset.colorMode = v.mode
  root.dataset.lightTheme = v.lightTheme
  root.dataset.darkTheme = v.darkTheme
  root.dataset.millTheme = v.resolvedMode
  root.dataset.millScheme = v.resolvedMode === 'dark' ? v.darkTheme : v.lightTheme
  // color-scheme drives native browser chrome (scrollbars, form control
  // rendering), which Primer's tokens never reach.
  root.style.colorScheme = v.resolvedMode
}

// The resolved theme, for a consumer outside React's tree (a plugin's
// onThemeChange). Read from the attributes applyAppearance writes, and
// observed the same way shared/density.ts observes data-density.
export function readResolvedTheme(root: HTMLElement = document.documentElement): { mode: ResolvedMode; scheme: string } {
  return {
    mode: root.dataset.millTheme === 'dark' ? 'dark' : 'light',
    scheme: root.dataset.millScheme ?? 'light',
  }
}

export function subscribeResolvedTheme(onChange: () => void, root: HTMLElement = document.documentElement): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(root, { attributes: true, attributeFilter: ['data-mill-theme', 'data-mill-scheme'] })
  return () => observer.disconnect()
}
