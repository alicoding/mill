import { useCallback, useMemo, useSyncExternalStore } from 'react'
import {
  getAppearance,
  normalizeMode,
  resolveSchemes,
  subscribeAppearance,
  type ResolvedMode,
} from '../shared/appearance'
import { getThemePreview, previewedAppearance, subscribeThemePreview } from '../shared/appearancePreview'
import { pluginThemes, subscribePluginThemes, type PluginThemeEntry } from '../shared/appearanceThemes'

export interface Resolved {
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

const NO_THEMES: PluginThemeEntry[] = []
function noThemes(): PluginThemeEntry[] {
  return NO_THEMES
}

function nullPreview(): null {
  return null
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
    const { lightTheme, darkTheme } = resolveSchemes(appearance, moreContrast, contributed)
    const resolvedMode = appearance.mode === 'auto' ? (systemDark ? 'dark' : 'light') : normalizeMode(appearance.mode)
    return previewedAppearance({
      mode: appearance.mode,
      lightTheme,
      darkTheme,
      resolvedMode,
      scheme: resolvedMode === 'dark' ? darkTheme : lightTheme,
    }, preview)
  }, [appearance, moreContrast, systemDark, preview, themes])
}
