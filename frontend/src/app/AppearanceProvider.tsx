import { useEffect, type PropsWithChildren } from 'react'
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
  setRemoteDensityHandler,
} from '../shared/appearance'
import { isKnownScheme } from '../shared/appearanceThemes'
import { installPluginThemes } from '../plugins/pluginTheme'
import { useResolvedAppearance } from './useResolvedAppearance'

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
