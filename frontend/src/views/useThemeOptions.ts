import { useMemo, useSyncExternalStore } from 'react'
import { pluginThemes, subscribePluginThemes, type PluginThemeEntry } from '../shared/appearanceThemes'
import type { ResolvedMode } from '../shared/appearance'

export interface ThemeOption {
  scheme: string
  label: string
  pluginName?: string
}

const EMPTY: PluginThemeEntry[] = []
function emptyThemes(): PluginThemeEntry[] {
  return EMPTY
}

// useThemeOptions joins one family's built-in schemes with every theme
// a running plugin contributes, in that order: what Mill ships first,
// what the user installed after it. Split from ThemePicker.tsx (goal
// 0419 S1b): a hook is not itself a component, so it broke
// react-refresh/only-export-components sitting beside ThemePicker.
export function useThemeOptions(family: ResolvedMode, builtIn: readonly string[], labelOf: (scheme: string) => string): ThemeOption[] {
  const contributed = useSyncExternalStore(subscribePluginThemes, pluginThemes, emptyThemes)
  return useMemo(() => [
    ...builtIn.map((scheme) => ({ scheme, label: labelOf(scheme) })),
    ...contributed.filter((c: PluginThemeEntry) => c.family === family).map((c: PluginThemeEntry) => ({ scheme: c.schemeId, label: c.label, pluginName: c.pluginName })),
  ], [family, builtIn, contributed, labelOf])
}
