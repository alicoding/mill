import { useCallback, useEffect, useMemo, useSyncExternalStore, type PropsWithChildren } from 'react'
import { ThemeProvider } from '@primer/react/next'
import { BaseStyles } from '@primer/react'
import { SettingsService } from '../shared/bindings'
import { applyDensity, type DisplayDensity } from '../shared/density'
import { applyAccent } from '../shared/accentScale'
import { background } from '../shared/background'
import {
  DARK_SCHEMES,
  LIGHT_SCHEMES,
  applyAppearance,
  getAppearance,
  setAppearance,
  normalizeMode,
  resolveSchemes,
  setRemoteDensityHandler,
  subscribeAppearance,
  type ResolvedMode,
} from '../shared/appearance'
import { getThemePreview, previewedSchemes, subscribeThemePreview } from '../shared/appearancePreview'
import { isKnownScheme, pluginThemes, subscribePluginThemes, type PluginThemeEntry } from '../shared/appearanceThemes'
import { installPluginThemes } from '../plugins/pluginTheme'

// AppearanceProvider is the one theming shell every Mill window mounts
// -- the main window and each auxiliary one (goal 0320). It replaced
// six copies of "read the color mode out of storage, wrap in
// ThemeProvider/BaseStyles", which is why a theme change used to reach
// only the window it was made in.
//
// ThemeProvider comes from @primer/react/next: the kit's current,
// CSS-variable theming API. The one on the package root is marked
// deprecated in its own types and differs only by also handing down a
// JavaScript theme object, which nothing here reads.
//
// BaseStyles (still the package root's -- @primer/react/next exports
// only ThemeProvider, Tooltip and the theme hooks) carries data-mill-theme/data-mill-scheme rather than a
// wrapper of Mill's own: it is already a descendant of the element
// Primer's theme rules match directly, which is what lets
// mill-tokens.css win the cascade (that file's header has the full
// reasoning), and it adds no node to the tree.

interface Resolved {
  mode: 'light' | 'dark' | 'auto'
  lightTheme: string
  darkTheme: string
  resolvedMode: ResolvedMode
  scheme: string
}

// prefers-contrast: more is the OS asking for a higher-contrast
// palette; under Match system it selects the chosen scheme's own
// high-contrast pair. prefers-color-scheme resolves Match system into
// the light or dark half.
function useMediaFlag(query: string): boolean {
  const subscribe = useCallback((cb: () => void) => {
    const m = window.matchMedia(query)
    m.addEventListener('change', cb)
    return () => m.removeEventListener('change', cb)
  }, [query])
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
}

export function useResolvedAppearance(): Resolved {
  const appearance = useSyncExternalStore(subscribeAppearance, getAppearance, getAppearance)
  const moreContrast = useMediaFlag('(prefers-contrast: more)')
  const systemDark = useMediaFlag('(prefers-color-scheme: dark)')
  // A plugin theme arriving or leaving changes what resolveSchemes
  // accepts, so the resolved pair has to be recomputed on it too.
  const themes = useSyncExternalStore(subscribePluginThemes, pluginThemes, noThemes)
  // The preview overrides the resolved pair without touching the
  // store, so nothing is persisted and no other window follows.
  const preview = useSyncExternalStore(subscribeThemePreview, getThemePreview, nullPreview)
  return useMemo(() => {
    const contributed = themes.map((t) => t.schemeId)
    const { lightTheme, darkTheme } = previewedSchemes(resolveSchemes(appearance, moreContrast, contributed), preview)
    const resolvedMode = appearance.mode === 'auto' ? (systemDark ? 'dark' : 'light') : normalizeMode(appearance.mode)
    return {
      mode: appearance.mode,
      lightTheme,
      darkTheme,
      resolvedMode,
      scheme: resolvedMode === 'dark' ? darkTheme : lightTheme,
    }
  }, [appearance, moreContrast, systemDark, preview, themes])
}

const NO_THEMES: PluginThemeEntry[] = []
function noThemes(): PluginThemeEntry[] {
  return NO_THEMES
}

function nullPreview(): null {
  return null
}

export function AppearanceProvider({ children }: PropsWithChildren) {
  const v = useResolvedAppearance()

  useEffect(() => {
    applyAppearance(document.documentElement, v)
  }, [v])

  // Density travels with the theme so an auxiliary window follows a
  // Settings change without a reload; the mount fetch is the value a
  // window that opened later starts from.
  useEffect(() => {
    setRemoteDensityHandler((d: DisplayDensity) => applyDensity(d))
    void background(SettingsService.GetDisplayDensity()
      .then((d) => applyDensity(d === 'compact' ? 'compact' : 'comfortable')), 'appearance.getDisplayDensity')
    return () => setRemoteDensityHandler(null)
  }, [])

  // Contributed themes are installed per WINDOW, not per plugin load:
  // the Quick Panel and the tray panel run no plugin code and still
  // have to paint in the theme the user chose. A choice whose plugin
  // is gone or turned off is dropped once the pass has actually run,
  // never on a failed read.
  useEffect(() => {
    void background(installPluginThemes().then((read) => {
      if (!read) return
      const a = getAppearance()
      const light = isKnownScheme(a.lightScheme, LIGHT_SCHEMES) ? a.lightScheme : 'light'
      const dark = isKnownScheme(a.darkScheme, DARK_SCHEMES) ? a.darkScheme : 'dark'
      if (light !== a.lightScheme || dark !== a.darkScheme) setAppearance({ ...a, lightScheme: light, darkScheme: dark })
    }), 'appearance.installPluginThemes')
  }, [])

  // The system accent is read once per window: the platform reports it,
  // Mill never stores or offers to change it, and "" keeps the built-in
  // accent (shared/accentScale.ts).
  useEffect(() => {
    void background(SettingsService.GetSystemAccent().then((raw) => applyAccent(raw ?? '')), 'appearance.getSystemAccent')
  }, [])

  return (
    <ThemeProvider colorMode={v.mode} dayScheme={v.lightTheme} nightScheme={v.darkTheme}>
      <BaseStyles data-mill-theme={v.resolvedMode} data-mill-scheme={v.scheme}>
        {children}
      </BaseStyles>
    </ThemeProvider>
  )
}
